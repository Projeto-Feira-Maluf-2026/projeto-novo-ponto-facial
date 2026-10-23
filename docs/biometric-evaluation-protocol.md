# Protocolo offline de avaliação biométrica

## Autorização e finalidade

Somente o controlador pode autorizar um dataset, sua finalidade, consentimento/base
legal, retenção e acesso. O script não comprova essas condições e não coleta rostos.
Embeddings continuam sendo dados biométricos sensíveis: use diretório local protegido,
identificadores pseudônimos, acesso mínimo e retenção/exclusão definidos. Não envie
dataset para Git, logs, mensagens, tickets ou serviços externos. Relatório contém
somente contagens/métricas agregadas; não publica identificadores ou vetores.

## Separação e representatividade

Defina previamente modelo/hash/versionamento, câmera/dispositivo, distância,
iluminação, óculos/EPI, poses, qualidade e população representativa. Amostras de
cadastro e teste precisam vir de sessões separadas; identificadores de amostra
não podem se repetir. O script verifica IDs únicos, mas não prova que imagens
foram separadas corretamente. Reserve um conjunto independente para validação
final; não escolher threshold com o mesmo conjunto usado para declarar desempenho.
Inclua consultas de pessoas conhecidas e desconhecidas do gallery, além de
falhas de aquisição. Documente recusas/exclusões; um teste só de embeddings ignora
imagem, aquisição, qualidade de consulta, rede e persistência.

## Entrada e execução

`scripts/calibrate_face_embeddings.py` lê JSON local até 64 MiB, sem câmera, banco,
rede, inferência ou mutação de configuração. Requer configuração local da aplicação
para importar as mesmas regras de matching; não imprime seus valores.

Estrutura: `templates` e `queries` são listas. Cada registro tem `sample_id` único
e `embedding` com 512 números finitos. Template requer `identity_id` pseudônimo
e `quality_score` entre 0 e 1. Query conhecida referencia identidade cadastrada;
query desconhecida usa `identity_id: null`. Vetor zero é rejeitado. IDs e rótulos
devem ter significado somente no dataset protegido.

```powershell
$env:PYTHONPATH = 'api'
api/.venv-audit/Scripts/python.exe scripts/calibrate_face_embeddings.py C:/dados-autorizados/avaliacao.json --authorized-dataset --threshold 0.62 0.78 --margin 0.06
```

O flag registra confirmação do operador para processamento local; não autoriza
coleta nem substitui aprovação do controlador. O script varre os thresholds
informados para comparação e **não altera os thresholds da aplicação**. Ao comparar
release, mantenha dataset, perfil e hardware idênticos e salve somente agregados.

## Métricas e interpretação

- FMR de verificação: aceitações contra identidade diferente / comparações impostoras.
- FNMR de verificação: recusas da identidade correta / comparações genuínas.
- 1:N open-set: aceitação de pessoa desconhecida / consultas desconhecidas.
- 1:N conhecida: recusa ou identidade errada / consultas conhecidas; relatório também
  separa aceitações com identidade errada.

O 1:N aplica score e margem do segundo candidato; verificação 1:1 compara uma
identidade específica. Identidade sem template elegível conta como rejeição, sem
sumir do denominador. Rates sem observações são `null`; zero erros não prova risco
zero. Intervalos Wilson 95% são apresentados como descritivos: comparações que
reutilizam pessoas/templates são correlacionadas e exigem protocolo estatístico
por identidade/sessão, por exemplo bootstrap agrupado. Tamanho da amostra e metas
FMR/FNMR devem ser definidos antes do ensaio pelo responsável de risco.

Os testes desta entrega usam exclusivamente vetores sintéticos de eixos ortogonais.
Verificam contagem, rejeição, splits e privacidade da saída; não homologam precisão,
demografia, EPI, cenário de obra ou limiares operacionais.

## PAD separado e release

Matching de embeddings não mede ataque de apresentação. Protocolo PAD deve incluir
impressão, telas/replay, instrumentos previstos no cenário, iluminação/dispositivos
e tentativas de injeção, com amostras autorizadas e rótulos independentes. Reportar
APCER/BPCER e incerteza por instrumento/cenário, documentando ataques não cobertos.
Desafio de uso único, movimento ou piscada não são evidência suficiente de PAD.

O provider atual permanece indisponível e falha fechado em staging/produção.
Não há modelo PAD fornecido ou resultado APCER/BPCER medido. Não habilitar aceitação
automática por fallback permissivo. Critérios e evidências de licença, privacidade,
precisão/PAD, dispositivo e operação devem ser aprovados antes de release autorizado.

Fontes técnicas: [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html)
descreve requisitos de biometria em autenticação; [NIST FATE PAD](https://www.nist.gov/publications/face-analysis-technology-evaluation-fate-part-10-performance-passive-software-based)
avalia PAD em imagens 2D. São referências técnicas, não certificação deste projeto.
