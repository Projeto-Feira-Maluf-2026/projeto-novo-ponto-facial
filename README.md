# Curitiba Empreiteira — Ponto Facial

Sistema web de controle de presença para obras, com reconhecimento facial, registro automático de ponto, relatórios, auditoria e confirmação por e-mail.

Produção:

- Aplicação: <https://curitiba-gestao.vercel.app>
- API facial: <https://curitiba-gestao-face.vercel.app>
- Saúde da API facial: <https://curitiba-gestao-face.vercel.app/health/ready>

## Funcionalidades

- Login e sessões pelo Supabase Auth.
- Perfis `SUPER_ADMIN`, `RH`, `GESTOR_OBRA`, `SUPERVISOR` e `FUNCIONARIO`.
- Cadastro de funcionários, obras, câmeras e biometria facial.
- InsightFace/ArcFace executado em container separado.
- Detecção e registro de até cinco rostos na mesma leitura.
- Registro de entrada, saída para almoço, retorno e saída.
- Uma segunda batida após as 16h é interpretada como saída, evitando “saída para almoço” à noite.
- Confirmação individual por e-mail usando SMTP da Brevo.
- Exportação de relatórios em PDF, XLSX e CSV.
- Auditoria de batidas e correções, atualizada automaticamente na interface.
- Funcionamento sem geolocalização obrigatória.

## Arquitetura

| Parte | Tecnologia | Hospedagem |
|---|---|---|
| Frontend | React, TypeScript e Vite | Vercel `curitiba-gestao` |
| API principal | FastAPI serverless | Vercel `curitiba-gestao` |
| IA facial | FastAPI, InsightFace e ONNX Runtime | Vercel Container `curitiba-gestao-face` |
| Autenticação | Supabase Auth | Supabase |
| Banco | PostgreSQL | Supabase |
| E-mail | SMTP | Brevo |

O frontend usa apenas a chave pública do Supabase. A chave secreta é utilizada somente em rotinas administrativas locais e nunca deve ser criada com prefixo `VITE_`.

## Horários

Todos os instantes são armazenados em UTC. A API envia datas UTC com o sufixo `Z`, enquanto telas, e-mails, dashboard e relatórios exibem `America/Sao_Paulo`. Essa regra evita diferenças de três horas entre Vercel, Supabase e navegador.

## Configuração local

1. Copie `.env.example` para `.env`.
2. Preencha as variáveis reais sem enviar o arquivo ao Git.
3. Aplique a migration em `supabase/migrations/20260807000000_initial.sql`.
4. Instale as dependências e crie/atualize o administrador.

```powershell
npm run setup
npm run bootstrap-admin
npm start
```

Endereços locais:

- Web: <http://localhost:5174/login>
- API: <http://localhost:8000>
- Swagger: <http://localhost:8000/api/docs>

### Variáveis principais

- `DATABASE_URL`: conexão PostgreSQL do Supabase.
- `SUPABASE_URL`: URL do projeto Supabase.
- `SUPABASE_PUBLISHABLE_KEY`: chave pública usada pelo frontend.
- `SUPABASE_SECRET_KEY`: chave administrativa, somente para scripts locais.
- `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`: configuração pública do navegador.
- `VITE_API_URL`: normalmente `/api/v1`.
- `VITE_FACE_API_URL`: URL HTTPS do container facial terminada em `/api/v1`.
- `BREVO_SMTP_HOST`, `BREVO_SMTP_PORT`, `BREVO_SMTP_LOGIN` e `BREVO_SMTP_KEY`: envio de e-mail.
- `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME` e `EMAIL_NOTIFICATIONS_ENABLED`: remetente e ativação das notificações.

Nunca envie `.env`, chaves SMTP, senhas ou tokens para o repositório.

## Comandos úteis

```powershell
npm run setup
npm run start
npm run stop
npm run bootstrap-admin
npm run seed
npm run web:build
npm run docker:up
npm run docker:down
```

## Docker

O Docker Compose inicia frontend, API e Redis. O banco continua sendo o PostgreSQL do Supabase configurado no `.env`.

```powershell
docker compose up --build
```

O container de produção usa `api/Dockerfile.vercel`. Instruções completas estão em [docs/vercel.md](docs/vercel.md).

## Testes

```powershell
cd api
.\.venv\Scripts\python.exe -m pytest ..\tests -q
.\.venv\Scripts\python.exe -m ruff check app ..\tests

cd ..\web
npm test -- --run
npm run build
```

Mais detalhes estão em `docs/`, especialmente `architecture.md`, `face-pipeline.md`, `terminal-automatico.md`, `security-lgpd.md` e `testing.md`.
