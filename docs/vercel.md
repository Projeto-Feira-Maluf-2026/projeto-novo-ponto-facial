# Deploy na Vercel

Mantenha **Root Directory** vazio para usar a raiz do repositorio. Cadastre todas as
variaveis de `.env.example` em **Settings > Environment Variables**.
Use a connection string do pooler em modo transaction fornecida por **Connect** no
Supabase para `DATABASE_URL`, pois Functions possuem conexoes curtas.

Variaveis obrigatorias:

```env
DATABASE_URL=postgresql+asyncpg://...
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_API_URL=/api/v1
```

Aplique a migration Supabase antes do deploy. Nunca exponha `SUPABASE_SECRET_KEY` em uma
variavel `VITE_*`.
