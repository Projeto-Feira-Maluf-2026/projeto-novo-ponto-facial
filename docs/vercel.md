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
PASSWORD_PEPPER=segredo-aleatorio-com-ao-menos-32-caracteres
FIELD_ENCRYPTION_KEY=chave-fernet-valida
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_API_URL=/api/v1
# URL pública do projeto Vercel Container facial.
VITE_FACE_API_URL=https://curitiba-gestao-face.vercel.app/api/v1
```

Aplique a migration Supabase antes do deploy. `SUPABASE_SECRET_KEY` nao e necessaria na
Vercel; ela deve existir somente no ambiente local usado pelo script administrativo.

## Dependencias de reconhecimento facial

O `requirements.txt` da raiz contem apenas as dependencias do runtime serverless da
Vercel. `numpy`, `pillow`, `opencv-python-headless`, `insightface` e `onnxruntime` ficam
fora desse manifesto, pois a cadeia de processamento facial ultrapassa o limite do bundle
Python. Essas dependencias permanecem no `api/pyproject.toml`.
O servidor Uvicorn nao faz parte desse manifesto. O SDK Python da Vercel permanece para
o endpoint opcional de upload no Blob.

O setup local e `api/Dockerfile.vercel` instalam `.[ai]`. O projeto facial usa Vercel
Containers, inclui o modelo verificado por SHA-256 na imagem e executa Uvicorn com
`FACE_RUNTIME_MODE=full`. A Function serverless principal continua leve.

Na Function serverless leve, autenticacao, cadastros, dashboard, relatorios, dispositivos
e consultas continuam disponiveis. Inferencia, matricula facial e batida biometrica
respondem `503 FACE_RUNTIME_NOT_INSTALLED`; `/api/v1/ai/capabilities` descreve essa
limitacao sem tentar importar as bibliotecas nativas.

## Backend facial em Vercel Container

Vincule `api/vercel.json` ao projeto facial e publique a raiz com o entrypoint
`api/Dockerfile.vercel`. O processo deve receber, no mínimo, as mesmas
variaveis `DATABASE_URL`, `SUPABASE_*`, `PASSWORD_PEPPER` e `FIELD_ENCRYPTION_KEY` da API
comum, alem destas:

```env
ENVIRONMENT=production
FACE_RUNTIME_MODE=full
FACE_PROVIDER=insightface
FACE_THRESHOLDS_CALIBRATED=true
CORS_ORIGINS=https://curitiba-gestao.vercel.app
FRONTEND_URL=https://curitiba-gestao.vercel.app
```

Use HTTPS publico; `localhost` aponta para o computador do visitante e HTTP e bloqueado
por navegadores quando a pagina esta em HTTPS. Depois de cadastrar `VITE_FACE_API_URL`
na Vercel, faca um novo deploy porque variaveis `VITE_*` sao incorporadas no build.

Antes de liberar a matricula, confirme:

```text
GET https://curitiba-gestao-face.vercel.app/health/live       -> 200
GET https://curitiba-gestao-face.vercel.app/api/v1/ai/capabilities
provider_ready                                                -> true
```

Nao remova a verificacao `is_lightweight_serverless()`: sem o container, ela evita que a
Function leve importe bibliotecas ausentes e transforme um erro explicativo em resposta
500.
