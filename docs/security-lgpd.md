# Seguranca e LGPD

- Supabase Auth gerencia credenciais, sessoes e renovacao de tokens.
- RBAC usa `app_metadata.role`, que nao e editavel pelo usuario final.
- A chave publishable pode ficar no navegador; a chave secret fica apenas no servidor.
- RLS bloqueia acesso direto do frontend aos dados operacionais e biometricos.
- SQLAlchemy usa consultas parametrizadas.
- Documentos e telefones ficam criptografados; templates faciais sao embeddings.
- Logs de auditoria e tentativas suspeitas suportam rastreabilidade.

Biometria e dado pessoal sensivel. A implantacao deve definir base legal, retencao,
controle de acesso, processo de exclusao e resposta a incidentes.
