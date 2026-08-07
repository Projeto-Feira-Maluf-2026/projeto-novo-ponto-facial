# Curitiba Empreiteira - Controle de Ponto Facial

Sistema corporativo de controle de ponto por reconhecimento facial para obras e canteiros, com FastAPI, React/TypeScript, Flutter, PostgreSQL, Redis e modulo de IA plugavel com InsightFace/ArcFace/ONNX Runtime.

O modo local usa SQLite para facilitar o primeiro teste. O Docker Compose usa PostgreSQL/Redis.

## Entrega

- Arquitetura completa em `docs/architecture.md`.
- Banco PostgreSQL em `docs/database.sql`.
- Diagramas em `docs/diagrams.md`.
- APIs em `docs/api.md`.
- Backend FastAPI em `api/`.
- Frontend React/TypeScript/Tailwind em `web/`.
- App mobile Flutter em `mobile/`.
- Sistema de IA em `api/app/services/ai/`.
- Dockerizacao em `docker-compose.yml`.
- Testes automatizados em `api/tests/`.
- Plano de implantacao em `docs/deployment.md`.
- Deploy na Vercel em `docs/vercel.md`.
- Seguranca/LGPD em `docs/security-lgpd.md`.
- Escalabilidade em `docs/scalability.md`.

## Funcionalidades principais

- Reconhecimento facial em tempo real por embeddings ArcFace.
- Cadastro facial com multiplas fotos por funcionario.
- Validacao de identidade com similaridade e relatorio de qualidade estruturado.
- Registro automatico de entrada, saida almoco, retorno e saida.
- Historico completo de registros.
- Dashboard administrativo com metricas em tempo real.
- Controle de obras, canteiros e dispositivos de captura.
- Gestao de cameras com webcam local, RTSP, IP, DVR/NVR, ONVIF, Intelbras, Hikvision, Dahua e genericas.
- Preview limpo de camera com enquadramento facial discreto e estados objetivos.
- Teste de conexao e snapshot autenticado de cameras por OpenCV.
- Geolocalizacao opcional com geofencing.
- Relatorios PDF, Excel e CSV.
- JWT, refresh token rotativo, RBAC e criptografia de alguns campos sensiveis.
- Protótipo mobile demonstrativo; captura real e fila transacional ainda não estão prontas.

## Estrutura

```text
api/
  app/
    api/v1/routes/
    core/
    models/
    schemas/
    services/
      ai/
  tests/

web/
  src/
    components/
    pages/
    services/
    types/

mobile/
  lib/
    main.dart
    src/

docs/
```

## Rodar tudo com um comando no Windows

Na raiz do projeto:

```powershell
npm start
```

Esse comando prepara automaticamente o ambiente quando necessario, inicia a API e o frontend em segundo plano e valida se ambos responderam. O alias `npm run dev` faz a mesma coisa.

Abra:

- Web: `http://localhost:5174/login`
- API: `http://localhost:8000`
- Swagger: `http://localhost:8000/docs`

Credenciais demo:

- Email: `admin@curitibaempreiteira.com`
- Senha: `Admin@12345`

Comandos uteis:

```powershell
npm run stop
npm run setup
npm run reset-db
npm run seed
npm run web:build
```

## Rodar com Docker

```bash
docker compose up --build
```

Servicos:

- Web: `http://localhost:8080`
- API: `http://localhost:8000`
- Swagger: `http://localhost:8000/docs`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

No ambiente local de desenvolvimento, crie o usuario administrador inicial:

```bash
curl -X POST http://localhost:8000/api/v1/auth/bootstrap-admin
```

Credenciais demo:

- Email: `admin@curitibaempreiteira.com`
- Senha: `Admin@12345`

## Fluxo facial funcional

Com a API e o Web abertos:

1. Entre em `http://localhost:8080/login` ou `http://localhost:5174/login`.
2. Acesse **Obras** e cadastre uma obra. A localizacao pode ser preenchida pelo navegador.
3. Acesse **Funcionarios**, cadastre um funcionario e vincule a obra.
4. No funcionário, clique no ícone de câmera e entre no enquadramento. O cadastro captura
   automaticamente as cinco poses, repete somente a etapa rejeitada e finaliza sozinho.
   Nenhum template é salvo antes da validação final.
5. Acesse **Ponto automático**. O terminal identifica a pessoa em 1:N, exige três
   leituras consecutivas e registra o movimento sem seleção manual de funcionário.

O navegador libera camera em `localhost` ou HTTPS. O backend não possui fallback facial:
se o pacote InsightFace real não carregar, cadastro, identificação e ponto facial falham
explicitamente. Consulte `/health/ready` e monte o modelo no container conforme
`models/README.md`.

Liveness temporal/challenge-response ainda pertence à Sprint 3. Pose, enquadramento e
qualidade não são apresentados como liveness. Enquanto não existir um PAD validado, o
servidor grava `liveness_score=null` e decide o ponto somente com similaridade e qualidade
realmente medidas; não cria scores padrão nem retorna `low_liveness` para uma câmera comum.
Staging e produção continuam sujeitos à política de calibração biométrica do ambiente.

## Configurar cameras

1. Acesse **Cameras de seguranca**.
2. Escolha o tipo: Webcam, RTSP, ONVIF, Intelbras, Hikvision, Dahua ou Generica.
3. Para webcam, selecione **Webcam local** e clique em **Testar camera**.
4. Para camera IP/RTSP, preencha IP, porta, usuario/senha ou a URL RTSP completa.
5. Clique em **Testar camera**.
6. Vincule a camera a uma obra.
7. Clique em **Salvar camera**.
8. Na tabela, clique no icone de olho para ver o preview limpo.

Exemplo RTSP comum:

```text
rtsp://usuario:senha@192.168.0.120:554/cam/realmonitor?channel=1&subtype=0
```

Observacoes:

- O navegador nao abre RTSP direto. A API faz a ponte com OpenCV e entrega snapshot/preview autenticado.
- Para DVR/NVR, use a URL RTSP do canal desejado.
- Para cameras Intelbras, Hikvision e Dahua, normalmente o RTSP vem no manual ou na tela de rede do equipamento.
- O modo debug fica separado no cadastro da camera e nao polui o preview.

## Desenvolvimento local

API:

```bash
cd api
copy .env.example .env
python -m venv .venv
.venv\Scripts\activate
pip install ".[dev]"
uvicorn app.main:app --reload --port 8000
```

O `.env.example` usa SQLite local (`ponto_facial.db`) para facilitar o primeiro uso sem Docker/PostgreSQL. No Docker, o `docker-compose.yml` continua sobrescrevendo `DATABASE_URL` para PostgreSQL.

Web:

```bash
cd web
npm install
npm run dev
```

Mobile:

```bash
cd mobile
flutter pub get
flutter run
```

## Validacao

```bash
cd api
pytest
ruff check .
alembic check
```

```bash
cd web
npm run build
```

## Observacoes de producao

O projeto ainda não está pronto para homologação. Consulte
`docs/baseline-sprint-1.md` para riscos abertos e critérios por sprint.
