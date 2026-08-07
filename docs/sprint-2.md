# Sprint 2 — cadastro guiado e comparação por identidade

## Diagnóstico confirmado

- O cadastro anterior aceitava cinco fotos livres, validava cada uma isoladamente e
  desativava templates antes de possuir uma sessão consistente.
- Os templates não guardavam dimensão, detector, normalização, métricas completas, pose,
  sessão de origem nem motivo de desativação.
- `identify-face` misturava identificação e verificação pelo campo opcional `employee_id`.
- A agregação favorecia o maior score e não fazia quality gating, centróide ou controle
  explícito da quantidade de templates por pessoa.
- Os 13 templates legados da base local não têm metadados suficientes para provar
  compatibilidade com o provider atual e foram marcados como `legacy-unknown`.

## Implementação

- Sessão de cadastro com expiração, ordem obrigatória e poses `FRONTAL`, `TURN_LEFT`,
  `TURN_RIGHT`, `LOOK_UP` e `FRONTAL_FINAL`.
- Rajadas de 3–5 frames com timestamp timezone-aware, intervalo mínimo, estabilidade,
  pose, qualidade e bloqueio de frames idênticos.
- Rejeição imediata de captura perceptualmente semelhante a uma pose já aceita e de
  timestamps fora de ordem. A única exceção é o par frontal inicial/final, que representa
  intencionalmente a mesma orientação em momentos diferentes.
- Reprocessamento integral na finalização, diversidade temporal/perceptual, similaridade
  par a par, mediana, desvio e outliers. A gravação é atômica; uma sessão inválida não
  cria templates parciais.
- Versionamento completo do template e rotina administrativa de listagem/invalidação.
  A invalidação desativa templates e marca os funcionários afetados para recadastro.
- Contratos separados para identificação 1:N e verificação 1:1. O 1:N restringe obra e
  vínculo ativo quando informados; o 1:1 nunca consulta outra identidade.
- Agregação escolhida: 55% centróide normalizado ponderado pela qualidade e 45% mediana
  dos top-K scores individuais ajustados pela qualidade. Templates abaixo do quality
  gate são descartados e no máximo cinco templates entram por identidade.
- Frontend guiado pelo contrato do servidor, com captura automática, repetição isolada da
  etapa rejeitada e finalização automática. O usuário pode pausar e usar captura manual.
- Poses laterais usam uma faixa própria de ângulo: o giro pedido pelo cadastro não é mais
  rejeitado pelo limite frontal da validação geral. Mensagens distinguem rosto fora do
  quadro, descentralizado, movimento insuficiente e movimento excessivo.
- Detecção multi-escala em `320`, `640` e `1280`, com o threshold configurado aplicado
  diretamente ao detector InsightFace. Em caso de rosto distante, o cliente faz recorte
  facial com margem e upscale; baixa iluminação/contraste aciona duas tentativas
  adaptativas no servidor.
- Filtragem dinâmica separa ecos fracos do detector de uma segunda face confiável. Isso
  reduz falso bloqueio em escala alta sem remover a regra de exatamente uma pessoa.
- Login reconstruído com campos independentes, autofill normalizado, estados de foco,
  erro, carregamento e senha visível, além de layout responsivo sem overflow em 390 px.
- Corrigida a reprovação falsa `low_liveness`: o serviço atribuía `0.5` a sinais ausentes
  mesmo declarando que PAD/liveness não estava disponível, contra um mínimo de `0.70`.
  O ponto agora usa somente similaridade e qualidade medidas no servidor, informa
  `liveness_evaluated=false` e grava `liveness_score=null`.
- O registro final reutiliza o mesmo quadro já aprovado na terceira leitura consecutiva,
  evitando que uma quarta captura diferente introduza blur, mudança de pose ou distância.
- Motivos técnicos do ponto foram convertidos em orientações claras em português na UI.
- Uma tentativa rejeitada não ativa mais o cooldown de 45 segundos nem informa ponto já
  registrado; o bloqueio por funcionário só começa após sucesso ou revisão manual.

## Migration

`20260717_0002_enrollment_sessions.py` cria `face_enrollment_sessions`, completa os
metadados de `face_templates` e adiciona a sinalização de recadastro em `employees`.
A base local foi migrada de `20260717_0001` para `20260717_0002`; a cópia anterior está
em `api/ponto_facial.pre-sprint2.db.bak`.

## Validação executada

```text
python -m ruff check app tests                    PASS
python -m pytest -q                              42 passed
python -m alembic upgrade head                   PASS
python -m alembic current                        20260717_0002 (head)
python -m alembic check                          No new upgrade operations detected
npm run build                                    PASS (TypeScript + Vite)
```

Teste visual do login:

- desktop em `1440 x 1000`: hierarquia, foco e painel corporativo validados;
- celular em `390 x 844`: sem overflow horizontal, campos com 62 px de altura;
- e-mail, senha, alternância de visibilidade e habilitação do envio validados;
- nenhum erro JavaScript no fluxo.

Teste sintético do detector real:

- perfil anterior de escala única: 5/6 detecções no conjunto severamente reduzido e
  degradado;
- perfil multi-escala: 6/6, com aumento consistente da confiança;
- custo medido no CPU local: aproximadamente 2,4 vezes a latência do detector. O valor
  exato deve ser recalibrado com a camera e o computador que serao usados na empresa.

Validação ASGI com o provider real local:

- `GET /ai/capabilities`: 200, `READY`, modelo `buffalo_l/w600k_r50` em CPU;
- `GET /ai/template-versions`: 200;
- rotina administrativa: 10 templates legados incompatíveis desativados e 2 funcionários
  marcados para recadastro;
- `POST /ai/identify-face`: contrato autenticado alcançado, payload inválido rejeitado
  como `INVALID_BASE64`;
- `POST /ai/verify-face`: mesmo comportamento estruturado;
- início/cancelamento de sessão: 201/200, cinco poses e transição persistida.

## Limitações abertas

- Os thresholds continuam operacionais e não calibrados; staging/produção permanecem
  bloqueados conforme a política da Sprint 1.
- Não foi adicionada imagem biométrica real ao repositório. A finalização completa precisa
  ser homologada com dataset autorizado e câmeras reais.
- Templates legados não podem ser reprocessados porque o sistema não retém as imagens de
  origem. Eles exigem recadastro guiado.
- Reconhecimento temporal, challenge-response/PAD, remoção total de sinais confiados ao
  cliente e backpressure/cancelamento do polling pertencem à Sprint 3.
- Auditoria da invalidação administrativa e regras completas de ponto/dispositivo ficam
  para as Sprints 3 e 4.
