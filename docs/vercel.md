# Deploy na Vercel

Frontend Vite e API FastAPI sao publicados no mesmo projeto Vercel. Importe o
repositorio com a raiz do projeto como **Root Directory**; o `vercel.json` cuida do
build do frontend, da Function Python e das rotas `/api/*`.

## Variaveis de ambiente

Existe um unico arquivo `.env` na raiz para desenvolvimento local. Na Vercel,
cadastre as mesmas chaves de `.env.example` em **Settings > Environment Variables**.
Gere valores seguros para os segredos:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Mantenha a URL relativa do frontend, pois API e site usam o mesmo dominio:

```env
VITE_API_URL=/api/v1
VITE_ENABLE_MOCKS=false
```

Sem `DATABASE_URL`, a aplicacao usa SQLite temporario e cria automaticamente o admin
demo na Function. Para dados persistentes, conecte um Postgres Neon e um Vercel Blob;
as integracoes fornecem `DATABASE_URL` e `BLOB_READ_WRITE_TOKEN`.

No banco persistente, defina `BOOTSTRAP_ADMIN_TOKEN`, `INITIAL_ADMIN_EMAIL` e
`INITIAL_ADMIN_PASSWORD`, publique e chame uma vez:

```bash
curl -X POST "https://SEU-SITE.vercel.app/api/v1/auth/bootstrap-admin" \
  -H "X-Bootstrap-Token: SEU_BOOTSTRAP_ADMIN_TOKEN"
```

## Modelo facial

O codigo nao baixa modelos ONNX automaticamente. Para a inferencia real, o diretorio
indicado por `FACE_MODEL_ROOT` precisa conter `models/buffalo_l/det_10g.onnx` e
`models/buffalo_l/w600k_r50.onnx`. Na Vercel, habilite Large Functions com
`VERCEL_SUPPORT_LARGE_FUNCTIONS=1` caso empacote os modelos com a API. Sem os arquivos,
o restante do sistema sobe normalmente, mas `/health/ready` permanece em 503 e as
operacoes faciais retornam indisponibilidade de forma explicita.

## Validacao

- `GET https://SEU-SITE.vercel.app/health/live` deve retornar 200.
- `GET https://SEU-SITE.vercel.app/health/ready` retorna 200 apenas com banco,
  modelo facial e thresholds de producao prontos.
- Abra `/login` no frontend e valide autenticacao, refresh e rotas internas.

Observacoes: Functions aceitam payloads de ate 4,5 MB, por isso o exemplo limita a
imagem bruta a 3 MB. Cameras RTSP em rede privada precisam de um gateway acessivel pela
API; webcam do navegador continua funcionando por HTTPS.
