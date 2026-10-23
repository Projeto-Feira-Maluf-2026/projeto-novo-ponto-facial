-- Expand-only. Do not apply before backing up and reviewing existing assignments.
-- No grants are inferred from email, user_metadata or employee names.
create table if not exists public.user_employee_links (
  user_id varchar(36) primary key,
  employee_id varchar(36) not null unique references public.employees(id) on delete cascade,
  active boolean not null default true,
  created_at timestamp not null default timezone('UTC', now()),
  updated_at timestamp not null default timezone('UTC', now())
);
create table if not exists public.user_worksite_grants (
  user_id varchar(36) not null,
  worksite_id varchar(36) not null references public.worksites(id) on delete cascade,
  active boolean not null default true,
  created_at timestamp not null default timezone('UTC', now()),
  updated_at timestamp not null default timezone('UTC', now()),
  primary key (user_id, worksite_id)
);
alter table public.user_employee_links enable row level security;
alter table public.user_worksite_grants enable row level security;
revoke all on public.user_employee_links from anon, authenticated;
revoke all on public.user_worksite_grants from anon, authenticated;
-- Abort instead of deleting or rewriting historical attendance when duplicates exist.
do $$ begin
  if exists (
    select 1 from public.attendance_records where offline_batch_id is not null
    group by employee_id, worksite_id, offline_batch_id having count(*) > 1
  ) then
    raise exception 'Duplicate attendance idempotency keys require reviewed remediation';
  end if;
end $$;
alter table public.attendance_records add constraint uq_attendance_idempotency
  unique (employee_id, worksite_id, offline_batch_id);

-- Rollback: deploy compatible application first; then DROP CONSTRAINT
-- uq_attendance_idempotency. Preserve both grant tables as the authorization audit source.
-- Never roll back resource enforcement without restricting manager/supervisor access.
