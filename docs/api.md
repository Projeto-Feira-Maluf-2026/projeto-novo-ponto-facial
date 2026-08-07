# APIs

Base local: `http://localhost:8000/api/v1`

Erros novos usam `{ "error": { "code", "message", "request_id", "details" } }`.
Todas as respostas HTTP incluem `X-Request-ID`.

## Saúde

- `GET /health/live`: processo da API ativo.
- `GET /health`: banco, Redis, provider/modelo real, runtime, dimensão e warm-up.
- `GET /health/ready`: retorna 503 enquanto o modelo real ou dependências obrigatórias
  não estiverem prontos. Staging/produção também exigem thresholds calibrados.

## Autenticacao

- `POST /auth/bootstrap-admin`: cria admin demo `admin@curitibaempreiteira.com` / `Admin@12345`.
- `POST /auth/login`: retorna access token e refresh token.
- `POST /auth/refresh`: rotaciona refresh token.
- `GET /auth/me`: usuario autenticado e escopos.

## Dashboard

- `GET /dashboard`: totais de funcionarios, presentes, ausentes, registros, horas, obras, dispositivos e alertas.

## Funcionarios

- `GET /employees`
- `POST /employees`
- `GET /employees/{employee_id}`
- `PATCH /employees/{employee_id}`
- `DELETE /employees/{employee_id}`: inativa o funcionario.
- `POST /employees/{employee_id}/photo`: upload de foto.
- `POST /employees/{employee_id}/face-enrollment-sessions`: inicia cadastro guiado e
  devolve poses, limites de frames, janela mínima e snapshot do modelo.
- `POST /employees/{employee_id}/face-enrollment-sessions/{session_id}/captures`:
  valida uma rajada da pose atual sem persistir template.
- `POST /employees/{employee_id}/face-enrollment-sessions/{session_id}/finalize`:
  reprocessa as cinco poses e persiste todos os templates em uma única transação.
- `DELETE /employees/{employee_id}/face-enrollment-sessions/{session_id}`: cancela a sessão.
- `POST /employees/{employee_id}/face-templates`: legado desativado; retorna
  `ENROLLMENT_SESSION_REQUIRED`.

## Obras

- `GET /worksites`
- `POST /worksites`
- `PATCH /worksites/{worksite_id}`

## Dispositivos

- `GET /devices`
- `POST /devices`
- `POST /devices/test-camera`: testa uma configuracao de camera antes de salvar.
- `POST /devices/{device_id}/test`: testa camera salva.
- `GET /devices/{device_id}/snapshot`: retorna um frame JPEG da camera salva.
- `POST /devices/heartbeat`: atualiza ultimo sinal via chave do dispositivo.

## Ponto

- `POST /attendance/punch`: registra ponto facial.
- `GET /attendance/history`: historico filtrado por funcionario, obra e periodo.

## Relatorios

- `POST /reports/export`: gera `pdf`, `xlsx` ou `csv`.

## Alertas

- `GET /alerts`: tentativas suspeitas, tipo de fraude, severidade e evidencias.

## IA

- `GET /ai/capabilities`: limites públicos seguros e estado do modelo.
- `POST /ai/analyze-face`: valida imagem, executa InsightFace e retorna detecção,
  landmarks, pose, qualidade separada, versão do modelo e timings. `liveness_evaluated`
  permanece `false` até a Sprint 3.
- `POST /ai/identify-face`: identificação 1:N, opcionalmente restrita por `worksite_id`.
  Considera apenas funcionários/vínculos ativos e templates totalmente compatíveis.
- `POST /ai/verify-face`: verificação 1:1; compara somente com o `employee_id` informado.
- `GET /ai/template-versions`: agrupa versões ativas e indica compatibilidade com o provider.
- `POST /ai/template-versions/invalidate`: desativa uma versão e marca os funcionários
  afetados para recadastro. Reprocessamento não é alegado porque as imagens não são retidas.

A agregação de identidade usa centróide normalizado ponderado pela qualidade e mediana dos
top-K scores individuais. Há quality gating e limite igual de templates por identidade.
Os scores continuam sendo similaridades não calibradas, não porcentagens de certeza.
