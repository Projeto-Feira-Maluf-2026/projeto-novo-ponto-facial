# Auditoria e implementação complementar — 10 de outubro de 2026

## Diagnóstico e limites da entrega

Checkout confirmado: `C:\Users\PCZIN\Desktop\projetos-uso\projeto-novo-ponto-facial`,
baseline `824178f`. A pasta do chat contém materiais, não a aplicação. Esta rodada
preservou e completou as alterações locais da primeira auditoria. Não houve
commit, push, deploy, migration em banco real, rotação nem coleta de rostos reais.

Stack preservada: React/TypeScript/Vite, FastAPI, SQLAlchemy/PostgreSQL/Supabase,
API facial separada, Redis, SMTP e protótipo Flutter. Supabase autentica; o servidor
decide papel, obra e funcionário. ADMIN/RH continuam abrangendo a organização
existente; não foi inventado um modelo multiempresa.

**A implementação local está validada pelos checks descritos abaixo. O sistema
não está homologado para produção: os gates externos permanecem abertos.**
O relatório `audit-2026-10-10.md` conserva o diagnóstico e os resultados da primeira
rodada; os números atuais e a decisão de release estão neste documento.

## Riscos por prioridade e evidência

| Prioridade | Evidência e estado |
|---|---|
| P0 restante | Gitleaks identificou seis ocorrências no histórico, incluindo possível chave OpenAI em `.env.example`, commit `e968a6f111e0a99fb6cea998f51d298365906478`. Validade não testada, valor não divulgado. Triagem/revogação pelo proprietário bloqueia release. |
| P0 corrigido | Papel confiado a metadata editável e embedding/confiança enviados pelo cliente: papel somente de app_metadata e reconhecimento por imagens processadas no servidor, com testes negativos. |
| P1 corrigido | Leituras, agregações e gravações sem obra/funcionário persistidos: grants e vínculo de usuário, critérios ORM para aliases/joins/counts/subqueries e flush. SQL bruto e bulk mutations de sessões restritas recusados. |
| P1 corrigido | Alertas podiam apontar funcionário externo e ocultavam rosto desconhecido: funcionário não nulo exige escopo; null é permitido para alerta somente dentro da obra autorizada, com regressões. |
| P1 corrigido | Horário/tipo e repetição manipuláveis: horário e sequência de ponto do servidor, cooldown independente do ID cliente, dispositivo validado, idempotência e constraint versionada. |
| P1 corrigido | Templates armazenados sem envelope: novas gravações Fernet; staging/produção recusam legado plaintext. Backfill e grants exigem rollout antes da ativação. |
| P1 restante | PAD real ausente, thresholds/dataset/dispositivo sem homologação. Staging/produção falham fechadas. Nenhum teste sintético comprova reconhecimento, liveness ou licença comercial. |
| P1 restante | PostgreSQL concorrente, restore, migrations, containers e mobile não executados no runtime real local. CI e testes preparados não equivalem a resultados de CI. |
| P1 corrigido | Inferência/exports/mutações sem quota: Redis atômico por identidade/dispositivo, 429 e timeout; Redis indisponível resulta em 503 nos ambientes implantados. Login/recuperação são do Supabase e exigem configuração de quotas no provedor. |
| P2 corrigido | Relatório truncado e nomes cortados: PDF com LongTable, cabeçalho repetido, wrap/escape e todas as linhas; limite explícito e erro recuperável. |
| P2 corrigido | Body/timeout e logs: limites para Content-Length e streaming, timeout, correlação, JSON redigido e métricas com labels limitados; sem valores de exceção. Segredos entre aspas com espaços e inputs secretos de erros de configuração cobertos por regressão. |
| P2 corrigido | Localhost/wildcard/regex CORS em produção: HTTPS e origens exatas obrigatórias; sem regex em staging/produção. |
| P2 corrigido | Dependências vulneráveis: Tailwind 4 com reset anterior preservado; urllib3 2.8.0; npm e Python incluindo extras AI/dev sem vulnerabilidades conhecidas nesta consulta. |
| P2 restante | Modelos externos ainda exigem cadeia completa de checksums, licença verificada e disponibilidade offline planejada. |
| P3 restante | Three.js gera chunk de 514,21 kB e aviso de build preexistente; carregamento sob demanda preservado. Não aumentamos limite para esconder o aviso. |

## Plano incremental executado

1. Preservar o checkout e consolidar autorização, integridade e armazenamento.
2. Implementar Worker, matching em blocos e contrato PAD indisponível explícito.
3. Completar relatórios, limites de API, cotas, observabilidade e CORS.
4. Atualizar locks, containers/CI, scripts locais e protótipo mobile.
5. Revisar independentemente os caminhos de escopo/logs, corrigir achados e executar checks.
6. Preparar protocolo biométrico e runbooks sem alterar dados/infraestrutura reais.

## Mudanças por categoria

### Segurança, autorização e dados

- Grants persistidos `UserWorksiteGrant` e `UserEmployeeLink`; sessão restrita sem
  vínculo autorizado resulta em 403. ORM scoped cobre listas, PK, joins e agregações;
  flush cobre criação/alteração/exclusão, bulk DML restrito é recusado.
- Envelope cifrado de embeddings com chave externa existente; script de backfill
  começa em dry-run e não foi aplicado a dados reais. Migration nova não executada.
- Tipo/hora de ponto derivados no servidor, dispositivo pertencente à obra,
  intervalo antirrepetição e constraint de idempotência por funcionário.
- PAD é verificado no servidor sobre frames decodificados. Provider ausente,
  exceção, score inválido ou decisão sem avaliação/modelo não autorizam ponto.
- CORS exato e HTTPS implantado; quotas Redis por buckets fixos, chaves de
  identidade hash e TTL. Defaults/minuto: ponto/IA 600, mutações120, relatórios 10,
  heartbeat 60; ajustar somente com medição e revisão. Redis obrigatório em
  staging/produção; fallback local limitado somente development/test.

### Biometria, câmera e performance

- MediaPipe passa para Worker ESM, OffscreenCanvas/CPU, um frame pendente,
  timeout e descarte de recursos. Loader WASM módulo corrigido; sem fallback
  silencioso que volte ao processamento síncrono.
- Matching vetorizado em blocos de 256, com validação finita/norma e regras de
  decisão preservadas. Benchmark sintético 512D / 5 templates / 21 repetições versus
  `824178f`: 100 identidades: 8,673 → 7,252 ms; 1.000 identidades: 86,556 → 82,970 ms.
  Mesma ordem, desvio máximo ≤ 1,7e-8. Isso mede matching, não captura, banco,
  inferência real, FPS, FMR/FNMR ou ganho operacional de ponta a ponta.
- Ferramenta offline de avaliação com dataset explicitamente autorizado,
  splits/IDs/dimensões validados e saída somente agregada: verification FMR/FNMR,
  1:N e intervalos de Wilson com limitações de correlação documentadas.

### API, relatórios e operação

- Exportação PDF paginada e dados escapados; CSV/XLSX resistem à interpretação de
  fórmulas; geração pesada fica fora do event loop, com duas exportações por
  processo. Máximo 10.000 linhas e 366 dias; excesso retorna 422, nunca truncamento.
- Body 64 MiB configurável/limitado e timeout 60 s; timeout HTTP não comprova parada
  de trabalho nativo/thread já iniciado. Dimensionar inferência e capacidade real.
- Logs JSON com request ID, rota template, status e duração; sem URL/query/payload
  ou valores de exceção. Métricas Prometheus autenticadas e labels limitados por
  processo; agregação externa e alertas ainda precisam implantação.
- Horas consolidadas usam intervalos ENTRY/LUNCH/EXIT completos, sem estimativa
  fixa por registro e sem estimar sessão aberta.
- Docker não-root, digests, locks, redes/portas/limites/read-only; CI com actions
  por SHA, scans/CodeQL/Dependabot e PostgreSQL sintético isolado. Runbooks de
  backup, credencial, indisponibilidade e rollback em `operations-runbook.md`.
- Setup determinístico Python 3.12/uv/npm; ambiente local padrão foi recriado em
  Python 3.12 e ambiente de auditoria permaneceu separado.
- `requirements.txt` leve para Vercel foi gerado com versões exatas do uv.lock,
  sem dependências nativas AI. CI verifica drift entre esse arquivo e o lock.

### Web e mobile

- Preservados reset, tokens, tipografia e navegação; cabeçalho desktop reserva a
  largura real das ações para evitar sobreposição, com navegação central rolável.
- Estados acessíveis no terminal/câmera; confirmação só com registro persistido,
  cache invalidado por sessão e descartes de respostas tardias.
- Mobile mantém protótipo, deixa de enviar embedding fictício e usa fila cifrada
  por usuário, operações serializadas, idempotência, retenção e confirmação real.
  Não constitui reconhecimento facial implementado/homologado no Flutter.

## Validações e resultados atuais

| Verificação | Resultado observado |
|---|---|
| `npm run check`, Python 3.12 isolado | PASS: Ruff, 243 testes backend, 58 web, TypeScript, build |
| Pytest iniciado dentro de `api`, equivalente ao CI |243 PASS, 1 SKIP; import do script de calibração corrigido no pythonpath do pytest |
| PostgreSQL concorrência real |1 SKIP: falta `PONTO_TEST_DATABASE_URL` local autorizado |
| `npm audit` lock raiz |0 vulnerabilidades conhecidas |
| pip-audit 2.10.1 do uv.lock extras AI + dev |0 vulnerabilidades conhecidas após upgrade de urllib3 |
| Gitleaks 8.30.1 arquivos publicáveis |0 achados no snapshot final dos arquivos tracked + untracked não ignorados |
| Gitleaks histórico Git |6 achados: gate bloqueado; não são todos credenciais confirmadas |
| Worker em navegador real |PASS carregamento modelos/WASM e bitmap sintético preto 640 × 480 → 0 rostos; não acessou câmera física |
| Dashboard no navegador |Mocks ficcionais,390 × 844 e 1280 × 900; sem overflow horizontal de documento; identidade preservada; cabeçalho desktop sem sobreposição após correção e atalho de teclado focou main-content. Não prova dados/fluxos reais. |
| PDF real sintético |250 linhas, nomes longos/marcador final e literal escapado extraídos em teste; preview de 80 linhas / 6 páginas inspecionado |
| YAML/PowerShell/scripts infra |Parse YAML,PS e 8 testes de entrypoint/segurança de restore aprovados |
| Docker/Flutter/restore real/migration/RLS real |Não executados; runtimes ausentes; 6 testes mobile preparados |
| PAD/câmera física/FMR/FNMR/biometria humana |Não executados; nenhuma certificação de precisão ou antisspoof |

## Próximos passos e gates de liberação

1. Proprietário da credencial faz triagem/revogação histórica e confirma pelos
   canais do provedor. Não reescrever Git sem coordenação nem esconder o achado.
2. Em ambiente isolado autorizado: migration/grants/backfill, negative scope/RLS,
   corrida PostgreSQL, restore e containers; provisionar Redis para todas as APIs
   implantadas. Ordem/rollback detalhados em `resource-access-and-biometric-storage.md`.
3. Licença/hash de todos os modelos, PAD servidor validado e dataset com finalidade,
   consentimento/base aplicável, retenção e autorização documentados. Executar
   `biometric-evaluation-protocol.md` nas câmeras e condições reais.
4. Flutter SDK: resolver lock real, analisar e rodar testes/Android; nunca afirmar
   compilação mobile a partir de leitura de Dart.
5. Executar CI/CodeQL/scans, conferir backup/alertas e fluxos críticos por teclado,
   mobile e sessão real. Só então autorizar release e verificação das duas APIs.

Estas etapas dependem de infraestrutura, dados autorizados ou ações do proprietário.
A instrução para completar trabalho local não autoriza alterações de produção,
revogação de chave, migration destrutiva ou coleta de rostos de terceiros.
