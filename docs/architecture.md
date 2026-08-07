# Arquitetura completa

O sistema foi estruturado como uma plataforma corporativa modular para controle de ponto facial em obras e canteiros da Curitiba Empreiteira.

## Componentes

- `api/`: FastAPI com Clean Architecture pragmatica, camada de servicos, repositorios, DTOs Pydantic, JWT, refresh token, antifraude e relatorios.
- `web/`: React + TypeScript + TailwindCSS para gestores, RH e supervisores.
- `mobile/`: Flutter para funcionarios e supervisores, com fila offline e sincronizacao.
- `docs/database.sql`: schema PostgreSQL inicial.
- `docker-compose.yml`: PostgreSQL, Redis, API e Web.
- `.github/workflows/ci.yml`: pipeline de teste e build.

## Camadas do backend

- API: rotas HTTP versionadas em `app/api/v1/routes`.
- Schemas: DTOs em `app/schemas`.
- Services: regras de negocio em `app/services`.
- AI providers: reconhecimento facial plugavel em `app/services/ai`.
- Models: entidades SQLAlchemy em `app/models`.
- Core: configuracao, seguranca, criptografia e permissoes.

## Fluxo de ponto facial

1. O dispositivo envia a imagem e os metadados do contexto.
2. A API valida payload, MIME, dimensões, detecção e qualidade.
3. O provider real executa detecção, alinhamento ArcFace e um único embedding.
4. A obra e validada por geofencing.
5. A API decide o tipo de batida automaticamente: entrada, saida almoco, retorno ou saida.
6. O fluxo legado persiste o registro; autenticação de dispositivo, idempotência e
   liveness temporal ainda precisam das Sprints 3 e 4.
7. Tentativas suspeitas geram alerta para gestores.

## IA modular

A interface `FaceProvider` expõe estado, modelo/checksum, detector, runtime ONNX,
dimensão e warm-up. Produção/desenvolvimento usam apenas InsightFace real. O
`FakeFaceProvider` é injetável somente com `FACE_PROVIDER=fake` e `ENVIRONMENT=test`.

O overlay MediaPipe no navegador auxilia o enquadramento, mas não decide identidade ou
liveness. A API não chama pose ou qualidade de liveness. Challenge-response temporal e
PAD permanecem explicitamente indisponíveis nesta sprint.

## Cadastro e comparação biométrica

O cadastro usa uma sessão curta com cinco poses e rajadas de múltiplos frames. O servidor
valida pose, qualidade, estabilidade, tempo, duplicidade perceptual, compatibilidade do
modelo e consistência par a par. Apenas resumos não biométricos ficam na sessão; os frames
continuam no cliente até a finalização, quando todas as poses são reprocessadas e os cinco
templates são gravados atomicamente.

Identificação 1:N e verificação 1:1 têm contratos e consultas separados. O primeiro pode
restringir candidatos por vínculo ativo com a obra e aplica top-1/top-2, margem e
ambiguidade. O segundo consulta somente a identidade declarada. Ambos exigem igualdade de
modelo, versão, dimensão, detector e normalização.

## Redis

Redis fica reservado para:

- cache de dashboard;
- pub/sub de eventos em tempo real;
- deduplicacao de registros offline;
- cooldown por dispositivo/funcionario;
- fila de notificacoes.
