# API

Base local: `http://localhost:8000/api/v1`.

## Autenticacao

Login, renovacao de sessao e logout sao fornecidos pelo Supabase Auth. O frontend envia
o access token em `Authorization: Bearer <token>`. `GET /auth/me` valida a sessao e retorna
usuario, papel e escopos.

## Rotas

- Saude: `GET /health/live`, `GET /health`, `GET /health/ready`.
- Dashboard: `GET /dashboard`.
- Funcionarios: `GET|POST /employees`, `GET|PATCH|DELETE /employees/{id}` e os fluxos
  `/face-enrollment-sessions`.
- Obras: `GET|POST /worksites`, `PATCH /worksites/{id}`.
- Dispositivos: `GET|POST /devices`, teste, snapshot e heartbeat.
- Ponto: `POST /attendance/punch`, `GET /attendance/history`.
- Relatorios: `POST /reports/export`.
- Alertas: `GET /alerts`.
- IA: `/ai/capabilities`, `/ai/analyze-face`, `/ai/identify-face`, `/ai/verify-face` e
  gerenciamento de versoes de templates.

Erros usam `{ "error": { "code", "message", "request_id", "details" } }` e as respostas
incluem `X-Request-ID`.
