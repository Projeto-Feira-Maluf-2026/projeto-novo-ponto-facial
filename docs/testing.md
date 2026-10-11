# Testes

O lockfile npm canônico é `package-lock.json` na raiz. Instale a partir da raiz
com `npm ci`; não mantenha um segundo lock em `web/`.
Python deve ser 3.12 e as dependências devem respeitar `api/uv.lock`.

```powershell
# uv instalado: ambiente padrão usado por npm run check
uv sync --project api --locked --extra dev --python 3.12
npm ci
npm run check

# Ambiente separado usado na auditoria, sem substituir o ambiente existente
$env:UV_PROJECT_ENVIRONMENT = '.venv-audit'
python -m uv sync --project api --locked --extra dev --python 3.12
$env:CHECK_PYTHON = "$PWD/api/.venv-audit/Scripts/python.exe"
npm run check
& $env:CHECK_PYTHON scripts/benchmark_face_matching.py --baseline 824178f
```

O benchmark usa somente vetores sintéticos. Não mede precisão facial, PAD,
inferência, banco ou câmera. Resultados e limitações em `audit-2026-10-10.md`.
O Docker web agora usa contexto da raiz: `docker build -f web/Dockerfile .`.
Para configuração real, prefira `docker compose build web`, que fornece os
argumentos públicos `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
`VITE_API_URL` e `VITE_FACE_API_URL` do ambiente. Nunca forneça service-role,
chave secreta ou senha em argumentos `VITE_*`.

```bash
cd api
pytest
ruff check app ../tests

cd ../web
npm run build
```

Os testes cobrem regras de ponto, processamento facial, contratos da API,
readiness e validacao da configuracao PostgreSQL. Testes de integracao devem usar um
projeto Supabase separado de producao.
