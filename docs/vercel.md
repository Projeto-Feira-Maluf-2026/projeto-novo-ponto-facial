# Deploy na Vercel

O repositorio deve ser importado em dois projetos Vercel. Essa separacao e o fluxo
estavel para um monorepo Vite + FastAPI e permite que frontend e API tenham builds,
variaveis e dominios independentes.

## 1. Banco de dados

Crie um Postgres no Marketplace da Vercel (Neon recomendado) e conecte-o ao projeto
da API. A integracao fornece `DATABASE_URL`; URLs `postgresql://` e os parametros
`sslmode`/`channel_binding` do Neon sao normalizados automaticamente para `asyncpg`.

## 2. Projeto da API

Importe o repositorio e configure **Root Directory** como `api`. O preset FastAPI,
Python 3.12, Fluid Compute e as migracoes Alembic ja estao configurados no codigo.

Cadastre as variaveis listadas em `api/.env.vercel.example` antes do primeiro deploy.
Gere valores seguros localmente:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Conecte tambem um Vercel Blob privado ao projeto da API. Ele injeta
`BLOB_READ_WRITE_TOKEN` e evita gravacoes no filesystem efemero da Function.

Depois do deploy, crie o primeiro administrador uma unica vez:

```bash
curl -X POST "https://SEU-BACKEND.vercel.app/api/v1/auth/bootstrap-admin" \
  -H "X-Bootstrap-Token: SEU_BOOTSTRAP_ADMIN_TOKEN"
```

Depois, remova `BOOTSTRAP_ADMIN_TOKEN`, `INITIAL_ADMIN_EMAIL` e
`INITIAL_ADMIN_PASSWORD` das variaveis e redeploye.

## 3. Projeto web

Importe o mesmo repositorio em um segundo projeto e configure **Root Directory** como
`web`. Defina:

```env
VITE_API_URL=https://SEU-BACKEND.vercel.app/api/v1
VITE_ENABLE_MOCKS=false
```

No projeto da API, ajuste `CORS_ORIGINS` para o dominio de producao do frontend. A
expressao `CORS_ORIGIN_REGEX=https://.*\\.vercel\\.app` libera previews da Vercel.

## 4. Modelo facial

O codigo nao baixa modelos ONNX automaticamente. Para a inferencia real, o diretorio
indicado por `FACE_MODEL_ROOT` precisa conter `models/buffalo_l/det_10g.onnx` e
`models/buffalo_l/w600k_r50.onnx`. Na Vercel, habilite Large Functions com
`VERCEL_SUPPORT_LARGE_FUNCTIONS=1` caso empacote os modelos com a API. Sem os arquivos,
o restante do sistema sobe normalmente, mas `/health/ready` permanece em 503 e as
operacoes faciais retornam indisponibilidade de forma explicita.

## 5. Validacao

- `GET https://SEU-BACKEND.vercel.app/health/live` deve retornar 200.
- `GET https://SEU-BACKEND.vercel.app/health/ready` retorna 200 apenas com banco,
  modelo facial e thresholds de producao prontos.
- Abra `/login` no frontend e valide autenticacao, refresh e rotas internas.

Observacoes: Functions aceitam payloads de ate 4,5 MB, por isso o exemplo limita a
imagem bruta a 3 MB. Cameras RTSP em rede privada precisam de um gateway acessivel pela
API; webcam do navegador continua funcionando por HTTPS.
