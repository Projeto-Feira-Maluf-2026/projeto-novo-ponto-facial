# Implantacao

## Supabase

1. Crie ou selecione o projeto.
2. Aplique `supabase/migrations/20260807000000_initial.sql` pelo SQL Editor ou CLI.
3. Copie a connection string de **Connect** para `DATABASE_URL`.
4. Configure as chaves `SUPABASE_*` e `VITE_SUPABASE_*` conforme `.env.example`.
5. Defina `INITIAL_ADMIN_*` e execute `npm run bootstrap-admin` uma unica vez.

O schema operacional usa RLS sem policies publicas. Usuarios e sessoes ficam apenas no
Supabase Auth.

## Aplicacao

```bash
docker compose up --build
```

O Compose inicia Web, API e Redis. O banco e sempre o Supabase. Antes de homologacao,
`GET /health/ready` deve responder 200 e os thresholds faciais devem estar calibrados.
