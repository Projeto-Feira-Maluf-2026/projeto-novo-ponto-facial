-- Indice de cobertura para o painel: o historico de 30 dias e as contagens do dia
-- filtram por occurred_at e leem apenas estas colunas. Com INCLUDE o Postgres
-- responde por index-only scan, sem visitar a tabela (heap) a cada registro.
-- IF NOT EXISTS mantem a migration idempotente; CONCURRENTLY nao e usado porque
-- o runner do Supabase executa cada migration dentro de uma transacao.

create index if not exists ix_attendance_occurred_cover
  on public.attendance_records (occurred_at)
  include (employee_id, worksite_id, status, punch_type);

analyze public.attendance_records;
