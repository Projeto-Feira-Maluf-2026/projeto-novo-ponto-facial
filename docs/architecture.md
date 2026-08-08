# Arquitetura

- `web/`: React, TypeScript e cliente Supabase Auth.
- `api/`: FastAPI, SQLAlchemy assincromo, regras de negocio e validacao de tokens Supabase.
- `supabase/migrations/`: fonte de verdade do schema PostgreSQL e RLS.
- `mobile/`: cliente Flutter.
- Redis: cache, eventos e deduplicacao.

O navegador autentica com a chave publishable. A API valida o token no Supabase Auth e
le o papel apenas de `app_metadata.role`. A chave secret permanece no backend/scripts.
Senhas, hashes de senha e sessoes nao fazem parte das tabelas da aplicacao.

Dados biometricos passam pela API. As tabelas do Data API tem RLS habilitado sem policies
para `anon` ou `authenticated`.
