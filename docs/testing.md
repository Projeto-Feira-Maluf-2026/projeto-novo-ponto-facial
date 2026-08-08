# Testes

```bash
cd api
pytest
ruff check .

cd ../web
npm run build
```

Os testes cobrem regras de ponto, geofencing, processamento facial, contratos da API,
readiness e validacao da configuracao PostgreSQL. Testes de integracao devem usar um
projeto Supabase separado de producao.
