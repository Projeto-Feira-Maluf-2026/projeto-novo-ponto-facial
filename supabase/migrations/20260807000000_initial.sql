-- Baseline do Ponto Facial para Supabase PostgreSQL.
-- Supabase Auth e a unica fonte de usuarios, senhas e sessoes.

create extension if not exists pgcrypto;

do $$ begin
  create type public.employeestatus as enum ('ACTIVE', 'INACTIVE', 'ON_LEAVE');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.punchtype as enum ('ENTRY', 'LUNCH_OUT', 'LUNCH_IN', 'EXIT');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.attendancestatus as enum ('ACCEPTED', 'REJECTED', 'MANUAL_REVIEW', 'OFFLINE_PENDING');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.devicestatus as enum ('ACTIVE', 'INACTIVE', 'MAINTENANCE');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.fraudtype as enum ('PRINTED_PHOTO', 'PHONE_SCREEN', 'VIDEO_REPLAY', 'MULTIPLE_FACES', 'LOW_LIVENESS', 'LOW_SIMILARITY', 'OUT_OF_GEOFENCE', 'UNKNOWN_FACE');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.alertseverity as enum ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.enrollmentsessionstatus as enum ('ACTIVE', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.enrollmentstate as enum ('WAITING_FACE', 'ALIGN_FACE', 'MOVE_CLOSER', 'MOVE_AWAY', 'IMPROVE_LIGHTING', 'LOOK_FORWARD', 'TURN_LEFT', 'TURN_RIGHT', 'LOOK_UP', 'HOLD_STILL', 'CAPTURED', 'DUPLICATE_CAPTURE', 'COMPLETED', 'FAILED');
exception when duplicate_object then null; end $$;

create table if not exists public.departments (
  id varchar(36) primary key default gen_random_uuid()::text,
  name varchar(120) not null unique,
  description text,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);

create table if not exists public.job_roles (
  id varchar(36) primary key default gen_random_uuid()::text,
  name varchar(120) not null unique,
  description text,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);

create table if not exists public.worksites (
  id varchar(36) primary key default gen_random_uuid()::text,
  name varchar(160) not null,
  code varchar(40) not null unique,
  address varchar(255) not null,
  manager_name varchar(160),
  latitude double precision,
  longitude double precision,
  geofence_radius_meters integer not null default 120,
  active boolean not null default true,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);

create table if not exists public.employees (
  id varchar(36) primary key default gen_random_uuid()::text,
  registration varchar(40) not null unique,
  name varchar(160) not null,
  document_encrypted varchar(512),
  phone_encrypted varchar(512),
  email varchar(190),
  department_id varchar(36) references public.departments(id),
  job_role_id varchar(36) references public.job_roles(id),
  status public.employeestatus not null default 'ACTIVE',
  consent_biometric_at timestamp,
  biometric_reenrollment_required boolean not null default false,
  biometric_reenrollment_reason varchar(255),
  photo_url varchar(255),
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);

create table if not exists public.employee_worksites (
  id varchar(36) primary key default gen_random_uuid()::text,
  employee_id varchar(36) not null references public.employees(id),
  worksite_id varchar(36) not null references public.worksites(id),
  starts_at timestamp,
  ends_at timestamp,
  active boolean not null default true,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now(),
  constraint uq_employee_worksite unique (employee_id, worksite_id)
);

create table if not exists public.capture_devices (
  id varchar(36) primary key default gen_random_uuid()::text,
  worksite_id varchar(36) not null references public.worksites(id),
  name varchar(120) not null,
  serial_number varchar(120) not null unique,
  api_key_hash varchar(255) not null,
  status public.devicestatus not null default 'ACTIVE',
  last_seen_at timestamp,
  metadata_json jsonb,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);

create table if not exists public.face_enrollment_sessions (
  id varchar(36) primary key default gen_random_uuid()::text,
  employee_id varchar(36) not null references public.employees(id),
  status public.enrollmentsessionstatus not null default 'ACTIVE',
  state public.enrollmentstate not null default 'ALIGN_FACE',
  required_poses jsonb not null,
  capture_summaries jsonb not null default '[]'::jsonb,
  model_name varchar(120) not null,
  model_version varchar(120) not null,
  embedding_dimension integer not null check (embedding_dimension > 0),
  detector_name varchar(120) not null,
  normalization_version varchar(120) not null,
  expires_at timestamp not null,
  completed_at timestamp,
  cancelled_at timestamp,
  failure_code varchar(80),
  failure_details jsonb,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);

create table if not exists public.face_templates (
  id varchar(36) primary key default gen_random_uuid()::text,
  employee_id varchar(36) not null references public.employees(id),
  model_name varchar(80) not null,
  model_version varchar(80) not null,
  embedding_dimension integer not null check (embedding_dimension > 0),
  detector_name varchar(120) not null,
  normalization_version varchar(120) not null,
  embedding bytea not null,
  image_sha256 varchar(64) not null,
  quality_score double precision not null check (quality_score between 0 and 1),
  quality_metrics jsonb not null,
  enrollment_session_id varchar(36) references public.face_enrollment_sessions(id),
  pose_json jsonb,
  collected_at timestamp not null,
  active boolean not null default true,
  deactivated_at timestamp,
  deactivation_reason varchar(255),
  created_at timestamp not null default now(),
  updated_at timestamp not null default now(),
  constraint uq_face_template_image unique (employee_id, image_sha256)
);

create table if not exists public.attendance_records (
  id varchar(36) primary key default gen_random_uuid()::text,
  employee_id varchar(36) not null references public.employees(id),
  worksite_id varchar(36) not null references public.worksites(id),
  device_id varchar(36) references public.capture_devices(id),
  punch_type public.punchtype not null,
  status public.attendancestatus not null,
  occurred_at timestamp not null default now(),
  latitude double precision,
  longitude double precision,
  similarity_score double precision,
  liveness_score double precision,
  quality_score double precision,
  confidence_score double precision,
  offline_batch_id varchar(80),
  notes text,
  metadata_json jsonb,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);

create table if not exists public.suspicious_attempts (
  id varchar(36) primary key default gen_random_uuid()::text,
  employee_id varchar(36) references public.employees(id),
  worksite_id varchar(36) references public.worksites(id),
  device_id varchar(36) references public.capture_devices(id),
  fraud_type public.fraudtype not null,
  severity public.alertseverity not null,
  confidence_score double precision,
  evidence_uri varchar(255),
  details jsonb,
  resolved_at timestamp,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);

create table if not exists public.audit_logs (
  id varchar(36) primary key default gen_random_uuid()::text,
  actor_user_id varchar(36),
  action varchar(120) not null,
  entity varchar(80),
  entity_id varchar(36),
  ip_address varchar(80),
  user_agent varchar(255),
  metadata_json jsonb,
  created_at timestamp not null default now()
);

create index if not exists ix_employees_registration on public.employees(registration);
create index if not exists ix_employees_name on public.employees(name);
create index if not exists ix_capture_devices_worksite_id on public.capture_devices(worksite_id);
create index if not exists ix_attendance_employee_date on public.attendance_records(employee_id, occurred_at);
create index if not exists ix_attendance_worksite_date on public.attendance_records(worksite_id, occurred_at);
create index if not exists ix_attendance_offline_batch on public.attendance_records(offline_batch_id);
create index if not exists ix_enrollment_employee on public.face_enrollment_sessions(employee_id);
create index if not exists ix_enrollment_expires on public.face_enrollment_sessions(expires_at);
create index if not exists ix_face_templates_employee on public.face_templates(employee_id);
create index if not exists ix_face_templates_enrollment on public.face_templates(enrollment_session_id);
create index if not exists ix_face_template_compatibility_active on public.face_templates(model_name, model_version, embedding_dimension, active);
create index if not exists ix_suspicious_employee on public.suspicious_attempts(employee_id);
create index if not exists ix_suspicious_worksite on public.suspicious_attempts(worksite_id);
create index if not exists ix_audit_action_created on public.audit_logs(action, created_at);

alter table public.departments enable row level security;
alter table public.job_roles enable row level security;
alter table public.worksites enable row level security;
alter table public.employees enable row level security;
alter table public.employee_worksites enable row level security;
alter table public.capture_devices enable row level security;
alter table public.face_enrollment_sessions enable row level security;
alter table public.face_templates enable row level security;
alter table public.attendance_records enable row level security;
alter table public.suspicious_attempts enable row level security;
alter table public.audit_logs enable row level security;

-- Sem policies: anon/authenticated nao acessam dados biometricos pelo Data API.
-- O backend usa a conexao PostgreSQL protegida do Supabase.
