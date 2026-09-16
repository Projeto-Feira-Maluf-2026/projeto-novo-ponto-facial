-- Indices orientados aos filtros reais usados pelo dashboard, historico e auditoria.
-- CREATE INDEX CONCURRENTLY nao pode ser usado pelo runner transacional do Supabase;
-- IF NOT EXISTS mantem a migration idempotente nos ambientes ja atualizados.

create index if not exists ix_attendance_occurred_at
  on public.attendance_records (occurred_at);

create index if not exists ix_attendance_status_occurred_at
  on public.attendance_records (status, occurred_at);

create index if not exists ix_capture_devices_last_seen_at
  on public.capture_devices (last_seen_at);

create index if not exists ix_suspicious_attempts_created_at
  on public.suspicious_attempts (created_at);

create index if not exists ix_audit_created_at
  on public.audit_logs (created_at);

create index if not exists ix_audit_entity_created_at
  on public.audit_logs (entity, created_at);
