# Desempenho — 24/10/2026

## Diagnóstico e riscos

- **P1, latência:** dashboard com 8 consultas sequenciais; cada ida ao PostgreSQL
  adicionava latência. Medição HTTPS antes da mudança: dashboard 1.081/774/714 ms;
  funcionários (200 por página) 541/381/367 ms; obras 320/323/312 ms. São três
  amostras da máquina de desenvolvimento, não um teste de carga/p95.
- **P1, reconhecimento:** normalização, seleção de templates e centroides repetidos
  para a mesma galeria em cada leitura. O cache anterior evitava SQL, mas não essa
  preparação. `analyze-face` e `verify-face` também executavam inferência síncrona
  no event loop da API, atrasando outras requisições no mesmo processo.
- **P2, listas:** páginas completas de 200 registros eram carregadas uma por vez,
  até o limite já existente de 25 páginas.
- **P2, capacidade:** teste remoto com imagem uniforme sintética, sem rosto e sem
  gravar ponto: 12.101 ms na primeira chamada e 4.341 ms na segunda; tempo interno
  total 8.057/4.152 ms. Esse caminho tenta detecção em várias resoluções/realces;
  **não representa a latência de reconhecer uma pessoa**. Cold start, CPU e upload
  continuam relevantes. Não se alterou modelo, PAD, qualidade ou thresholds.
- **P2, configuração preexistente:** serviço facial publicado usa `development` e
  não há calibração/PAD de produção aprovados. Esta otimização não certifica a
  segurança biométrica nem muda esse ambiente para contornar os bloqueios.
- **P3, bundle:** chunk 3D de aproximadamente 550 KB, já carregado sob demanda;
  aviso preexistente de build, sem mudança visual nesta entrega.

## Plano incremental e mudanças

1. Dashboard: 8 → **3 consultas**, contadores independentes em subqueries ORM,
   presença/quantidade reaproveitadas do stream do dia. A projeção carrega apenas
   as quatro colunas necessárias, em lotes de 500, sem notas/metadados completos.
   Permissões por obra/funcionário continuam aplicadas inclusive às subqueries.
2. Listas: primeira página determina o total; demais páginas em grupos de **3**,
   mantendo ordem, deduplicação, teto de 25 e erro explícito se uma página falhar.
3. Reconhecimento: snapshot de vetores normalizados e centroides imutáveis.
   Reutiliza o TTL anterior de 30 segundos, com limite de 16 galerias por processo,
   separadas por modelo, identidade, obra e escopo persistido de autorização.
   Cadastro/recadastro continua invalidando o cache. O funcionário vencedor
   continua sendo consultado no banco e todas as decisões de registro permanecem
   no servidor. Nada de biometria nova no Redis, navegador, log ou disco.
4. Identificação em grupo prepara a galeria uma vez por requisição/modelo.
   Análise e verificação passam o trabalho nativo para `asyncio.to_thread`,
   preservando a trava de inferência do provider sem bloquear o event loop.

Sem dependências novas, migrations, alterações de esquema, perda de recursos ou
mudanças nos critérios de similaridade, ambiguidade, qualidade e liveness.

## Verificação reproduzível

```powershell
npm run check
api/.venv/Scripts/python.exe scripts/benchmark_face_matching.py --employees 100 1000 --repeats 9
```

Benchmark local, seed 20261010, 5 templates/identidade, 512 dimensões, sem imagens
ou serviços externos; mediana de 9 repetições:

| Identidades | Antes (`ac4d79d`) | Galeria quente | Preparação inicial |
|---|---:|---:|---:|
| 100 | 9,019 ms | 1,391 ms | 8,120 ms |
| 1.000 | 94,129 ms | 14,617 ms | 74,853 ms |

Mesma ordem das identidades e diferença máxima dos scores **0** no benchmark.
A melhora de aproximadamente 6,4× se refere **somente à comparação de vetores**,
não à captura, rede, inferência, PAD ou gravação de ponto.

Regressões cobertas: contadores positivos/negativos com escopo de recurso, horas
trabalhadas, rejeitados, revisão manual, 3 queries, limite de paralelismo, ordem e
falha de paginação, equivalência matemática da galeria, vetores inválidos, TTL,
invalidação, isolamento por autorização/obra, limite de cache e thread de análise.

Verificação local final: Ruff, TypeScript e build passaram; 333 testes Python
passaram e 1 teste PostgreSQL isolado foi pulado; 103 testes web passaram.

## Publicação e rollback

Usuário autorizou publicar somente após validar. Preservar os deployments atuais
de ambos os projetos; publicar cada runtime e conferir readiness, autenticação,
leituras protegidas, rejeições anônimas e assets. Comparar HTTPS depois do deploy
com o mesmo percurso, distinguindo variação de rede de ganho de código.

Base para rollback: commit `ac4d79d`; principal
`dpl_DfzTvVfmJf8NzTAQaFofqwehiSF1`; facial
`dpl_CGM6H2rLTBbrMzDT3RkwUXyyQduG`. Usar promoção/rollback suportado pela conta,
sem excluir deployments, forçar Git ou contornar cotas.

Não foram realizados teste real com câmera/funcionário, teste de carga ou aprovação
de precisão/PAD. Validar com operadores nos dispositivos reais após publicação;
se a inferência ainda dominar, medir capacidade/região/CPU antes de contratar ou
mudar hardware. Nenhum plano pago foi autorizado.
