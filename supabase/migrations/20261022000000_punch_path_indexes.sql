-- Indices para as consultas executadas em toda batida do terminal facial.
-- IF NOT EXISTS mantem a migration idempotente; CONCURRENTLY nao e usado porque
-- o runner do Supabase executa cada migration dentro de uma transacao.

-- Templates elegiveis de uma obra: employee_worksites filtrado por obra e ativo.
create index if not exists ix_employee_worksites_worksite_active
  on public.employee_worksites (worksite_id, active, employee_id);

-- Somente templates ativos participam da comparacao.
create index if not exists ix_face_templates_active_employee
  on public.face_templates (employee_id)
  where active;

-- Protecao contra batida duplicada do mesmo terminal (janela de 1 minuto).
create index if not exists ix_attendance_employee_worksite_created
  on public.attendance_records (employee_id, worksite_id, created_at desc);
