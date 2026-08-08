# Curitiba Empreiteira - Controle de Ponto Facial

Sistema corporativo de controle de ponto por reconhecimento facial para obras e
canteiros. A aplicacao usa FastAPI, React/TypeScript, Supabase Auth, Supabase
PostgreSQL, Redis e InsightFace/ArcFace.

## Arquitetura atual

- Supabase Auth gerencia usuarios, senhas, sessoes e renovacao de tokens.
- Supabase PostgreSQL armazena os dados operacionais.
- O frontend usa somente a chave `publishable`.
- O backend valida cada access token no Supabase e aplica RBAC pelo campo seguro
  `app_metadata.role`.
- A chave `secret` existe apenas no backend e nos scripts administrativos.
- O Data API permanece bloqueado por RLS; dados biometricos passam pela API FastAPI.

O projeto nao possui banco local, usuario/senha proprio nem tabela de refresh tokens.

## Configuracao

Copie `.env.example` para `.env` e preencha:

- `DATABASE_URL`: connection string PostgreSQL exibida em **Connect** no Supabase.
- `SUPABASE_URL`: URL do projeto.
- `SUPABASE_PUBLISHABLE_KEY`: chave permitida no navegador.
- `SUPABASE_SECRET_KEY`: chave exclusiva do backend.
- `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`: equivalentes do frontend.
- `INITIAL_ADMIN_*`: credenciais usadas uma unica vez pelo bootstrap administrativo.

Nunca crie uma variavel `VITE_*` com a chave `secret`.

## Preparar o Supabase

1. Aplique [a migration inicial](supabase/migrations/20260807000000_initial.sql) pelo
   SQL Editor ou Supabase CLI.
2. Crie o administrador inicial:

```powershell
npm run bootstrap-admin
```

3. Inicie o projeto:

```powershell
npm start
```

Abra:

- Web: `http://localhost:5174/login`
- API: `http://localhost:8000`
- Swagger: `http://localhost:8000/docs`

## Comandos

```powershell
npm run setup
npm run bootstrap-admin
npm run seed
npm run dev
npm run stop
npm run web:build
```

## Docker

O Compose inicia API, frontend e Redis. O PostgreSQL e sempre o Supabase configurado
em `.env`.

```bash
docker compose up --build
```

## Validacao

```bash
cd api
pytest
ruff check .

cd ../web
npm run build
```

Documentacao complementar esta em `docs/`.
