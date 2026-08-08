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

## Dependencias de reconhecimento facial

O `requirements.txt` da raiz contem apenas as dependencias do runtime serverless da
Vercel. `numpy`, `pillow`, `opencv-python-headless`, `insightface` e `onnxruntime` ficam
fora desse manifesto, pois a cadeia de processamento facial ultrapassa o limite do bundle
Python. Essas dependencias permanecem no `api/pyproject.toml`.
O servidor Uvicorn e o SDK Python da Vercel tambem nao fazem parte desse manifesto, pois
a Function ASGI nao importa nenhum deles.

O setup local e a imagem Docker ja instalam `.[ai]`. Para executar inferencia facial em
producao, use o container da API com os modelos montados em `FACE_MODEL_ROOT`, ou habilite
Large Functions no projeto da Vercel e adapte o provisionamento dos modelos. A Vercel nao
recebe os binarios em `models/` neste deploy.

Na Function serverless leve, autenticacao, cadastros, dashboard, relatorios, dispositivos
e consultas continuam disponiveis. Inferencia, matricula facial e batida biometrica
respondem `503 FACE_RUNTIME_NOT_INSTALLED`; `/api/v1/ai/capabilities` descreve essa
limitacao sem tentar importar as bibliotecas nativas.
