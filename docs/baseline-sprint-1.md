# Fase 0 e Sprint 1 — baseline confirmado

Data do diagnóstico: 2026-07-17.

## Mapa do projeto

- Backend: FastAPI assíncrono, SQLAlchemy, SQLite local e PostgreSQL no Compose.
- Web: React 18, TypeScript, Vite e MediaPipe Tasks no navegador.
- Mobile: Flutter demonstrativo, com payloads fixos e fila em SharedPreferences.
- IA: InsightFace/ArcFace/ONNX Runtime no backend e MediaPipe apenas para overlay local.
- Banco: modelos SQLAlchemy, SQL de referência e, a partir desta sprint, Alembic.
- Infraestrutura: Dockerfiles, Compose, scripts PowerShell e CI básico.
- Testes: unitários do backend; sem testes web, E2E ou mobile no repositório.

## Baseline executado antes das alterações

| Verificação | Resultado inicial |
|---|---|
| `pytest -q` | 9 testes aprovados |
| `ruff check .` | falhou: import `sqlalchemy.func` não usado |
| `npm run build` | aprovado; JS principal 421,91 kB (132,91 kB gzip) |
| `flutter test` | não executado: Flutter SDK ausente no host |
| `docker compose config` | não executado: Docker CLI ausente no host |
| `/health` | endpoint isolado respondeu 200, mas só informava `status=ok` |
| Banco local | SQLite respondeu `SELECT 1` |
| Redis local | indisponível; não havia processo na porta 6379 |
| InsightFace | `buffalo_l/w600k_r50`, CPUExecutionProvider, dimensão 512 carregado |

## Matriz de diagnóstico

| Funcionalidade | Estado confirmado | Problema/risco | Prioridade | Ação | Critério de aceite |
|---|---|---|---|---|---|
| Provider facial | Corrigido na Sprint 1 | Havia fallback Haar/DCT/hash silencioso, permitindo templates falsos | P0 | Remover fallback, verificar modelo/runtime e usar estados explícitos | Falha do modelo não produz embedding; fake só funciona em `ENVIRONMENT=test` |
| Readiness facial | Corrigido na Sprint 1 | `/health` dizia OK sem carregar o modelo | P0 | Separar live/health/ready e expor modelo, checksum, provider e warm-up | `/health/ready` só fica 200 com modelo real, banco e política do ambiente prontos |
| Validação da imagem | Base implementada na Sprint 1 | Base64, MIME, pixels, blur, luz, pose e enquadramento não tinham validação conjunta | P0 | Normalizar EXIF/cor e gerar relatório estruturado | Payload inválido é rejeitado antes da inferência e qualidade não é chamada de liveness |
| Pipeline ArcFace | Corrigido na Sprint 1 | Original e crop 768×768 eram amostras independentes | P0 | Usar uma única detecção/alinhamento/embedding do InsightFace | Uma imagem gera no máximo um embedding compatível |
| Contratos de erro | Corrigido na Sprint 1 | Erros eram strings ou exceções engolidas | P0 | Envelope com código, mensagem, detalhes e request ID | Erros faciais têm código estável e não expõem stack trace |
| Migrations | Corrigido na Sprint 1 | `create_all`/SQL manual eram os únicos mecanismos | P0 | Alembic inicial e runner para schema legado compatível | Banco vazio sobe em `head` e `alembic check` não encontra diff |
| Liveness temporal | Aberto | Um frame, pose, qualidade e scores do cliente ainda alimentam o endpoint de ponto | P0/Sprint 3 | Challenge-response com nonce e evidência temporal no servidor | Nenhuma decisão depende de boolean/score aberto do cliente |
| Cadastro guiado | Parcial | Cinco capturas livres; só duplicata byte a byte é rejeitada nesta sprint | P0/Sprint 2 | Máquina de estados, poses, estabilidade, consistência e deduplicação perceptual | Sessão atômica rejeita repetição e identidade divergente |
| Identificação | Parcial | Ainda não há separação formal 1:1/1:N nem agregação calibrada | P0/Sprint 2 | Endpoints separados, candidatos compatíveis, top-1/top-2 e margem | Testes cobrem ambiguidade e não há vantagem por número de templates |
| Thresholds | Bloqueado para produção | Valores atuais não têm dataset/calibração | P0/Sprint 7 | Perfil explícito e relatório FAR/FRR/TAR/ROC/EER | Produção não fica ready sem `FACE_THRESHOLDS_CALIBRATED=true` |
| Requisições do terminal | Parcial | Identificação ainda usa polling e não sessão temporal | P0/Sprint 3 | Sessão, melhores frames, cancelamento e backpressure | Requisições obsoletas são canceladas e identidade é estável na janela |
| Regras de ponto/dispositivo | Aberto | Vínculo, autenticação de dispositivo, idempotência e concorrência incompletos | P0/Sprint 4 | Aplicar regras transacionais e constraint idempotente | Corridas não geram duas batidas e device arbitrário é rejeitado |
| Autenticação | Aberto | Bootstrap público, refresh no localStorage e rotas web sem proteção completa | P0/P1 | Restringir bootstrap, cookie/revogação, `/me` e RBAC visual | Produção não possui credencial demo e rotas exigem sessão válida |
| Mobile | Demonstrativo | Obra/device/GPS/embedding/scores fixos e fila não transacional | P1/Sprint 6 | Reimplementar captura, autenticação, GPS e fila local | Nenhum payload simulado permanece |
| Frontend corporativo | Parcial | Botões/telas e estados de erro ainda incompletos | P1/Sprint 5 | Finalizar CRUDs, revisão, auditoria e testes | Toda ação visível tem comportamento e autorização |
| Redis | Reservado | Compose tinha Redis, mas o backend não usa cache/sessão/cooldown | P1 | Implementar usos declarados ou remover a alegação | Documentação e comportamento coincidem |

## Limites técnicos desta sprint

- Não existe modelo PAD passivo validado. O relatório deixa `occlusion_score` e
  `eyes_closed` como não avaliados em vez de inventar um score.
- A qualidade usa guardrails configuráveis e explicitamente não calibrados; não é
  confiança de identidade, liveness ou probabilidade estatística.
- O endpoint de ponto legado ainda aceita scores/embedding do cliente. O web deixou de
  enviá-los, mas a remoção do contrato ocorre junto da sessão temporal na Sprint 3.
- O modelo real está disponível no host Windows validado, mas não é versionado no Git.
  O container exige montagem explícita do diretório de modelos.
- O SQLite local contém 13 templates legados (`buffalo_l` /
  `insightface-arcface-onnx`), dos quais 10 estavam ativos. Eles não são comparados com
  `buffalo_l/w600k_r50` + checksum e precisam de recadastro; nenhuma migração biométrica
  artificial foi executada.
- Flutter e Docker não puderam ser executados neste host por ausência das CLIs.
