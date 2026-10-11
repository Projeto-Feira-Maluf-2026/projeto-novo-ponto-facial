# Autorização por recurso e transição de biometria

Estado local: código e migration preparados; nenhum banco real foi alterado.

`SUPER_ADMIN` e `RH` conservam alcance organizacional global desta aplicação.
Não existe modelo de tenant/multiempresa: estes papéis não devem ser concedidos
como administradores limitados a uma empresa em uma instalação compartilhada.
`GESTOR_OBRA`/`SUPERVISOR` precisam de grants ativos em `user_worksite_grants`.
`FUNCIONARIO` precisa de um vínculo único ativo `user_employee_links`; suas obras
derivam de associações de funcionário ativas, com início/fim respeitados.
Nenhum vínculo é inferido por nome, matrícula, email ou metadata do cliente.

O operador autorizado deve revisar cada UUID Supabase e recurso e provisionar
grants diretamente pela conexão administrativa, sob procedimento de auditoria.
Não há endpoint público de provisionamento. A migration habilita RLS e revoga
acesso `anon`/`authenticated` aos vínculos. Não usa service-role no browser.
Ausência/revogação de grant bloqueia a próxima requisição: não existe cache de
vínculos. Tokens Supabase já emitidos conservam a semântica de expiração do
provedor; grants não são uma promessa de revogação instantânea de todos os JWTs.

Cada dependência de permissão carrega a associação do banco e instala critérios
ORM na sessão daquela requisição: lista, count, joins, subqueries, lookup por ID,
relationships e operações ORM recebem o mesmo escopo. SQL textual é recusado
para sessões restritas; o dashboard foi convertido para ORM. Flush de registros
novos/alterados também valida obra e funcionário. IDs fora do escopo não são
revelados. Associações expiradas restringem o histórico; revisão de histórico de
ex-funcionários deve ser feita por RH até existir política explícita de acesso.

## Ordem de transição

1. Backup verificado e aplicação da migration em ambiente isolado autorizado.
2. Revisão manual dos vínculos e grants reais; provisionamento pelo operador.
3. Ensaio de rollback e concorrência PostgreSQL; revisão de dados duplicados.
4. Release autorizada da aplicação; verificação de acesso positivo e negativo.

Migration `20261010000000_resource_grants_idempotency.sql` é expand-only e aborta
se houver chaves idempotentes duplicadas. Não elimina nem corrige ponto histórico.
Rollback remove o constraint depois de versão compatível; conserva tabelas como
evidência. Reverter autorização exige suspender os usuários restritos.

Batidas online passam a usar timestamp e sequência existentes do servidor.
Timestamp/tipo recebido vira somente metadata de proveniência e não governa o
registro. O cooldown de um minuto vale mesmo sem ID e sem prefixo `terminal-`.
A chave estável é única por funcionário/obra. Isto não cria política de jornada
nem um protocolo offline autenticado: captura atrasada não é homologada como
evento histórico e precisa do fluxo auditado de correção pelo responsável.

## Armazenamento de templates

Novas escritas ORM são cifradas por Fernet autenticado com envelope `CEBIO1:` e
a chave existente `FIELD_ENCRYPTION_KEY`. Matching recebe bytes decifrados apenas
em memória. MAC inválido/chave incorreta falha, sem fallback para plaintext.
Registros legacy continuam legíveis somente em development/test durante a
transição; staging/production recusam plaintext. Não há mudança de tipo SQL.
Fernet protege conteúdo e autenticidade do token; não liga o token à identidade
da linha e não substitui autorização, auditoria e integridade do banco.

O script `scripts/encrypt_legacy_embeddings.py` é read-only por padrão e informa
somente contagens. `--apply` é uma mudança de dados sensíveis e precisa autorização
explícita do responsável. Processa lotes pequenos, commits e locks por linha;
reexecução ignora envelopes já cifrados. Não imprime vetor nem chave. Executar
em maintenance window, com backup, chave guardada fora do banco e ambiente
isolado ensaiado. Sem backfill executado, dados existentes não estão confirmados
como cifrados. Não destruir/rotacionar a chave enquanto algum backup ou registro
precisar dela. A versão anterior do código não lê os novos envelopes; rollback
de aplicativo deve manter o decoder, sem exportar plaintext como atalho.

## Limites biométricos

PAD server-side é obrigatório em staging/production. Sem provider avaliado,
o registro retorna `PAD_UNAVAILABLE` e não persiste batida. A capability expõe
`pad_required`, `pad_available` e `biometric_attendance_available`. Não há modelo
PAD validado fornecido: produção permanece bloqueada. Development/test são
protótipos, não presença homologada. Desafio anti-replay de uso único ainda exige
protocolo, dispositivo autenticado e modelo avaliado; não foi simulado como
segurança pela simples presença de múltiplos frames.

Horas do dashboard representam apenas intervalos adjacentes completos de pontos
aceitos: ENTRY→LUNCH_OUT/EXIT e LUNCH_IN→EXIT no dia consultado. Intervalo aberto,
virada de dia e correções pendentes não são estimados; não é cálculo de folha.

Referências: [SQLAlchemy session events](https://docs.sqlalchemy.org/en/20/orm/session_events.html),
[Fernet](https://cryptography.io/en/latest/fernet/),
[PostgreSQL constraints](https://www.postgresql.org/docs/current/ddl-constraints.html).

## Quotas de requisições

Mutações autenticadas recebem quotas por usuário e classe de recurso: ponto e
IA 600/min, demais mutações 120/min, exports 10/min; heartbeat 60/min por ID de
dispositivo depois de autenticar sua chave e antes de alterar o registro.
IDs de recurso e valores enviados pelo cliente não criam buckets arbitrários.
Os limites são configuráveis por `RATE_LIMIT_*_PER_MINUTE`. A janela fixa de um
minuto pode permitir bursts na fronteira entre janelas; não é token bucket.

Redis compartilhado executa INCR e EXPIRE na mesma operação Lua, com TTL de dois
minutos. Chaves usam hash do principal, classe fixa e janela; não incluem JWT,
email ou chave do dispositivo. O timeout padrão é 0,3s. Em staging/produção,
Redis indisponível bloqueia mutações com 503. `REDIS_REQUIRED` passa a ser
obrigatório nesses ambientes, mantendo readiness consistente com esse gate.
Provisionar Redis privado e autenticado, rede/ACL e quotas de capacidade antes
da release autorizada; observar erros, latência e 429. Não rotacionar credencial
nem mudar produção sem autorização.

Development/test admitem fallback em memória com TTL e no máximo 4096 chaves;
capacidade esgotada retorna 503 e não descarta contadores ativos para liberar
quota. Esse fallback não coordena múltiplos processos e não é permitido em
produção. 429 informa `Retry-After`; UI/integrações devem aguardar, evitando
loops agressivos. Operações de câmera em lote consomem uma requisição por lote.

Login, recuperação e cadastro de contas pertencem ao Supabase Auth externo:
configurar e verificar as quotas/captcha do provedor e do perímetro é requisito
operacional separado. O limiter da API não afirma limitar esses endpoints
externos, nem substitui proteção de tráfego anônimo na borda. A análise facial
passa a exigir sessão e permissão antes de consumir inferência.
Referência: [Redis INCR e rate limiter](https://redis.io/docs/latest/commands/incr/).
