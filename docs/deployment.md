# Plano de implantacao

## Ambiente local

```bash
docker compose up --build
```

Servicos:

- Web: `http://localhost:8080`
- API: `http://localhost:8000`
- Swagger: `http://localhost:8000/docs`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

Crie o admin inicial:

```bash
curl -X POST http://localhost:8000/api/v1/auth/bootstrap-admin
```

## Homologacao

O sistema ainda não atende os critérios de homologação. Antes de qualquer piloto,
`GET /health/ready` deve responder 200 e deve existir relatório de calibração do modelo,
câmera e cenário.

1. Cadastrar obras reais com coordenadas e raio.
2. Cadastrar dispositivos por obra.
3. Cadastrar funcionarios e coletar 5 poses guiadas por pessoa (Sprint 2).
4. Rodar piloto em uma obra por 5 dias uteis.
5. Calibrar limiares em dataset de homologação e registrar FAR/FRR/TAR/EER.
6. Validar relatorios com RH e folha.
7. Treinar supervisores para revisar alertas.

## Producao

- Usar PostgreSQL gerenciado com backup PITR.
- Usar Redis gerenciado ou cluster.
- Executar API com multiplas replicas.
- Servir web por CDN ou Nginx.
- Guardar segredos em vault.
- Habilitar TLS obrigatorio.
- Configurar observabilidade: logs, metricas, traces e alertas.
- Separar armazenamento de evidencias em bucket privado.

## CI/CD

O workflow `.github/workflows/ci.yml` executa testes da API e build do web. Para producao, adicione etapas de build/push de imagens e deploy em Kubernetes, ECS, Cloud Run ou VM com Docker Compose.

## Banco e modelo

- Alembic é a fonte de verdade: `cd api && python -m app.db.migrate`.
- `AUTO_CREATE_TABLES` fica desativado e é rejeitado fora de development.
- O provider não baixa ONNX automaticamente. Monte a raiz InsightFace em `/models`
  ou configure `FACE_MODEL_HOST_PATH` no Compose.
- Configure `FACE_MODEL_SHA256` quando o artefato aprovado for promovido.
