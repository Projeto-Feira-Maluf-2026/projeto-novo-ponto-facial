# Operação, recuperação e gates

Esta revisão é local. Docker, Flutter/Dart e PostgreSQL/pg_dump/pg_restore não
estavam disponíveis na máquina; os ensaios desses runtimes ainda precisam passar.
Não houve deploy, rotação de credencial, alteração de banco real ou uso de biometria real.

## Backup e restauração

- Definir com o responsável RPO/RTO antes de habilitar produção. Proposta inicial
  para aprovação: RPO de 24 horas e RTO de 4 horas; não são compromissos já cumpridos.
- Confirmar plano Supabase e disponibilidade de backups/PITR. Agendar backup diário
  lógico separado usando `pg_dump --format=custom --no-owner --no-acl`, via
  conexão direta ou session pooler e papel de backup com privilégio mínimo.
- Usar arquivo de serviço PostgreSQL e `pgpass` protegido; não passar a URL com
  senha na linha de comando, no log ou em exemplo. Criptografar arquivo com uma
  chave externa, guardar fora do repositório, com acesso restrito e trilha de acesso.
- Proposta de retenção para aprovação: 7 diários/4 semanais, com exclusão automática;
  backup de imagens/Blob exige plano separado. Templates cifrados dependem de backup
  das chaves por processo separado. Dump sem chave não prova recuperação biométrica.
- Em ensaio autorizado: provisionar banco separado vazio, restaurar com
  `pg_restore --no-owner --no-acl --exit-on-error`, aplicar migrations necessárias,
  conferir counts, constraints, policies/RLS, escopo negativo, histórico e integridade
  dos templates cifrados. Nunca restaurar sobre produção para testar backup.
- Registrar data, release, hash do arquivo cifrado, duração, counts, resultado e quem
  validou. Ensaiar mensalmente e após mudanças de schema/chave/storage.

O script `scripts/verify_postgres_restore.py` testa lock de linha, rollback e
dump/restauração de **uma tabela sintética**, somente em loopback e com bancos
temporários de nome aleatório. Ele não valida backup Supabase/RLS/Blob nem o fluxo
completo de ponto. `.github/workflows/ci.yml` oferece serviço PostgreSQL isolado
para executá-lo; o job não foi executado nesta revisão local.

```powershell
# Configure ISOLATED_POSTGRES_URL para PostgreSQL LOCAL de ensaio (/postgres).
# Tenha pg_dump/pg_restore 16 no PATH. Nunca reutilize o .env de produção.
api/.venv/Scripts/python.exe scripts/verify_postgres_restore.py
```

## Indisponibilidade ou fila travada

1. Correlacionar request ID com erros/latência. Verificar `/health/live` e
   `/health/ready` separadamente; liveness não comprova banco/modelo/PAD pronto.
2. API facial indisponível/PAD indisponível: manter falha fechada. Não reduzir
   threshold, simular liveness ou aceitar embedding de cliente para recuperar.
3. Banco indisponível: interromper confirmação de ponto; exibir recuperação e
   preservar IDs de idempotência. Comparar replay com registro persistido.
4. Redis indisponível com `REDIS_REQUIRED=true`: recuperar Redis antes de readiness.
   Redis roda em rede interna no Compose, sem porta pública.
5. E-mail indisponível: revisar erro redigido. Não repetir registro de ponto para
   reenviar notificação. Escalar fila SMTP/retry conforme o serviço implementado.

## Release ruim e rollback

Antes de publicar: lint/testes/build, scans, migration de escopo, protocolo PAD,
licença do modelo, câmera real, backup restaurado e revisão de teclado/mobile.
Após release autorizado: verificar ambas APIs, build ID, capacidades, login,
cadastro, ponto persistido, replay e relatório, comparando erro/latência com baseline.
Rollback: reimplantar release anterior compatível com o schema; migrations novas
devem ter rollback documentado e ensaio. Não reativar falhas de autorização para
restaurar disponibilidade. Se incompatível, suspender mutações e corrigir adiante.

## Credencial potencialmente exposta

Gitleaks 8.30.1 verificou o histórico Git e encontrou seis entradas, inclusive um
literal com formato OpenAI em `.env.example`, commit
`e968a6f111e0a99fb6cea998f51d298365906478`. A validade não foi testada e valores
não foram publicados. O scanner de CI deve bloquear o gate até triagem/revogação;
não há baseline para esconder esse achado. Os demais achados históricos em
`.env.example`, `api/.env.example` e `docs/vercel.md` também exigem triagem.

Com autorização do dono da conta: revogar/rotacionar no provedor, rever uso e
custos/auditoria, atualizar ambientes pelo canal secreto e confirmar revogação.
Reescrever história exige coordenação explícita com colaboradores; apagar a linha
atual não remove histórico e não revoga uma chave. Nunca usar a credencial para
testar se ainda funciona. Só aceitar exceção documentada para placeholder
comprovado ou credencial revogada, por fingerprint preciso e revisão humana.

## Alertas por impacto

Configurar no provedor antes de release, sem registrar fotos/embeddings/tokens:
- readiness facial/banco falhando por 2 minutos;
- taxa de 5xx > 2% durante 5 minutos, com volume mínimo de 20 requests;
- p95 de ponto acima do SLO aprovado por 10 minutos;
- backup ausente > 26 horas ou ensaio de restauração falho;
- CPU/RAM acima de 85% sustentado, Redis backlog ou SMTP falhando repetidamente.

Esses limites são propostas iniciais; nenhum alerta externo foi criado nesta revisão.

## Containers e supply chain

API e web usam não-root, locks e bases por digest oficial. Compose aplica
read-only, `cap_drop: ALL`, `no-new-privileges`, CPU/RAM/PIDs e tmpfs limitada.
Volumes existentes de uploads/Redis podem exigir ajuste de owner pelo operador
antes de subir (API UID/GID 10001, Redis usuário redis); não houve chown de dados reais.
Web usa nginx em 8080 com temporários em /tmp; host somente loopback.
API mantém rede externa para Supabase/SMTP; somente cache é rede interna.
Os limites são baseline de desenvolvimento e precisam medição com inferência real.
Vercel recebe PORT da plataforma; default do container passou a 8000.
`FORWARDED_ALLOW_IPS` deve conter proxies conhecidos se headers encaminhados
forem necessários; não confiar em `*` na API local acessível diretamente.

CI fixa commits reais das actions e oferece Gitleaks por release/checksum,
CodeQL security-extended e auditoria npm/API (incluindo extra AI). CodeQL em
repositório privado requer GitHub Code Security habilitado; execução local
do workflow não comprova disponibilização dessa licença. Dependabot oferece
atualizações semanais pequenas. Downloads de modelo ainda requerem integridade
completa do detector/archive e comprovação de licença, além do hash de reconhecimento.

Fontes primárias consultadas: [Compose services](https://docs.docker.com/reference/compose-file/services/),
[uv Docker](https://docs.astral.sh/uv/guides/integration/docker/),
[GitHub secure use](https://docs.github.com/en/actions/reference/security/secure-use),
[PostgreSQL pg_dump](https://www.postgresql.org/docs/16/app-pgdump.html),
[Supabase backups](https://supabase.com/docs/guides/platform/backups).
