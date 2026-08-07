# Testes automatizados

## API

Testes unitarios cobrem:

- geofencing;
- avaliador legado de liveness (ainda não é PAD temporal);
- sequencia automatica de batidas;
- bloqueio de provider fake/fallback;
- payload, MIME, dimensões e qualidade facial;
- contrato de erro/request ID e readiness;
- migration inicial e paridade com a metadata.

Com dependencias instaladas:

```bash
cd api
pytest
ruff check .
alembic check
```

## Web

```bash
cd web
npm install
npm run build
```

## Mobile

```bash
cd mobile
flutter pub get
flutter test
```

## Testes recomendados para producao

- Testes de integracao com PostgreSQL e Redis.
- Testes de carga em `/attendance/punch`.
- Testes de dispositivo offline com sincronizacao atrasada.
- Testes de vies, iluminacao, oclusao e baixa qualidade de camera.
- Pentest autenticado e nao autenticado.
