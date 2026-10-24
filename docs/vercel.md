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
PASSWORD_PEPPER=<gere-segredo-aleatorio-de-pelo-menos-64-caracteres>
FIELD_ENCRYPTION_KEY=chave-fernet-valida
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_API_URL=/api/v1
# URL pÃºblica do projeto Vercel Container facial.
VITE_FACE_API_URL=https://curitiba-gestao-face.vercel.app/api/v1
```

Aplique a migration Supabase antes do deploy. `SUPABASE_SECRET_KEY` nao e necessaria na
Vercel; ela deve existir somente no ambiente local usado pelo script administrativo.

## Cold start e configuração de produção

Use somente origens HTTPS necessárias em `CORS_ORIGINS`, por exemplo
`https://curitiba-gestao.vercel.app`. Na produção/staging, entradas HTTP loopback
legadas (`localhost`, `127.0.0.1` e `::1`) são descartadas, nunca autorizadas.
Outras origens HTTP ou URLs malformadas continuam impedindo a inicialização.
`FRONTEND_URL` deve ser uma origem HTTPS, sem caminho.

Esta versão exige Redis disponível para limitar mutações em produção. Defina
`REDIS_URL` para o serviço distribuído real; o padrão local não é suficiente.
Sem Redis, mutações falham fechadas com 503 e readiness não deve ficar saudável.
Com a integração Upstash conectada usando prefixo `PONTO_LIMIT`, a API prefere
automaticamente `PONTO_LIMIT_REDIS_URL` (obrigatoriamente TLS) a `REDIS_URL`.
Assim, a integração mantém e rotaciona a credencial sem cópias manuais. Valor
ausente ou vazio preserva a configuração Redis existente, inclusive no Docker.
Use plano gratuito e `autoUpgrade=false` quando não houver autorização de custos.
O serviço facial também exige calibração/PAD conforme o ambiente: não mude
`ENVIRONMENT` para development para contornar as proteções de produção.

Depois de um deploy autorizado, confira `/api/health/live` (JSON 200),
`/api/health/ready` (JSON 200 somente com dependências saudáveis) e
`/api/v1/dashboard` sem token (JSON 401). Um build marcado Ready não confirma
que a Function conseguiu importar a aplicação. Em caso de 500
`FUNCTION_INVOCATION_FAILED`, consulte os logs de runtime, sem expor segredos.

Diagnóstico e testes da recuperação: [recovery-2026-10-23.md](recovery-2026-10-23.md).

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
`api/Dockerfile.vercel`. O processo deve receber, no mÃ­nimo, as mesmas
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
