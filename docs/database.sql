-- Referencia legada para consulta. Alembic em api/alembic e a fonte de verdade.
-- Nao monte este arquivo junto com as migrations no mesmo banco.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$ BEGIN
  CREATE TYPE userrole AS ENUM ('SUPER_ADMIN', 'RH', 'GESTOR_OBRA', 'SUPERVISOR', 'FUNCIONARIO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE employeestatus AS ENUM ('ACTIVE', 'INACTIVE', 'ON_LEAVE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE punchtype AS ENUM ('ENTRY', 'LUNCH_OUT', 'LUNCH_IN', 'EXIT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE attendancestatus AS ENUM ('ACCEPTED', 'REJECTED', 'MANUAL_REVIEW', 'OFFLINE_PENDING');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE devicestatus AS ENUM ('ACTIVE', 'INACTIVE', 'MAINTENANCE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE fraudtype AS ENUM ('PRINTED_PHOTO', 'PHONE_SCREEN', 'VIDEO_REPLAY', 'MULTIPLE_FACES', 'LOW_LIVENESS', 'LOW_SIMILARITY', 'OUT_OF_GEOFENCE', 'UNKNOWN_FACE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE alertseverity AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE enrollmentsessionstatus AS ENUM ('ACTIVE', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE enrollmentstate AS ENUM ('WAITING_FACE', 'ALIGN_FACE', 'MOVE_CLOSER', 'MOVE_AWAY', 'IMPROVE_LIGHTING', 'LOOK_FORWARD', 'TURN_LEFT', 'TURN_RIGHT', 'LOOK_UP', 'HOLD_STILL', 'CAPTURED', 'DUPLICATE_CAPTURE', 'COMPLETED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS users (
  id varchar(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  name varchar(160) NOT NULL,
  email varchar(190) NOT NULL UNIQUE,
  password_hash varchar(255) NOT NULL,
  role userrole NOT NULL DEFAULT 'SUPERVISOR',
  active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id varchar(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  user_id varchar(36) NOT NULL REFERENCES users(id),
  token_hash varchar(255) NOT NULL UNIQUE,
  expires_at timestamp NOT NULL,
  revoked_at timestamp,
  device_label varchar(120),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS departments (
  id varchar(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  name varchar(120) NOT NULL UNIQUE,
  description text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS job_roles (
  id varchar(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  name varchar(120) NOT NULL UNIQUE,
  description text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS worksites (
  id varchar(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  name varchar(160) NOT NULL,
  code varchar(40) NOT NULL UNIQUE,
  address varchar(255) NOT NULL,
  manager_name varchar(160),
  latitude double precision,
  longitude double precision,
  geofence_radius_meters integer NOT NULL DEFAULT 120,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employees (
  id varchar(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  registration varchar(40) NOT NULL UNIQUE,
  name varchar(160) NOT NULL,
  document_encrypted varchar(512),
  phone_encrypted varchar(512),
  email varchar(190),
  department_id varchar(36) REFERENCES departments(id),
  job_role_id varchar(36) REFERENCES job_roles(id),
  status employeestatus NOT NULL DEFAULT 'ACTIVE',
  consent_biometric_at timestamp,
  biometric_reenrollment_required boolean NOT NULL DEFAULT false,
  biometric_reenrollment_reason varchar(255),
  photo_url varchar(255),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employee_worksites (
  id varchar(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  employee_id varchar(36) NOT NULL REFERENCES employees(id),
  worksite_id varchar(36) NOT NULL REFERENCES worksites(id),
  starts_at timestamp,
  ends_at timestamp,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT uq_employee_worksite UNIQUE(employee_id, worksite_id)
);

CREATE TABLE IF NOT EXISTS capture_devices (
  id varchar(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  worksite_id varchar(36) NOT NULL REFERENCES worksites(id),
  name varchar(120) NOT NULL,
  serial_number varchar(120) NOT NULL UNIQUE,
  api_key_hash varchar(255) NOT NULL,
  status devicestatus NOT NULL DEFAULT 'ACTIVE',
  last_seen_at timestamp,
  metadata_json jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS face_enrollment_sessions (
  id varchar(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  employee_id varchar(36) NOT NULL REFERENCES employees(id),
  status enrollmentsessionstatus NOT NULL,
  state enrollmentstate NOT NULL,
  required_poses jsonb NOT NULL,
  capture_summaries jsonb NOT NULL,
  model_name varchar(120) NOT NULL,
  model_version varchar(120) NOT NULL,
  embedding_dimension integer NOT NULL CHECK (embedding_dimension > 0),
  detector_name varchar(120) NOT NULL,
  normalization_version varchar(120) NOT NULL,
  expires_at timestamp NOT NULL,
  completed_at timestamp,
  cancelled_at timestamp,
  failure_code varchar(80),
  failure_details jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS face_templates (
  id varchar(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  employee_id varchar(36) NOT NULL REFERENCES employees(id),
  model_name varchar(80) NOT NULL,
  model_version varchar(80) NOT NULL,
  embedding_dimension integer NOT NULL CHECK (embedding_dimension > 0),
  detector_name varchar(120) NOT NULL,
  normalization_version varchar(120) NOT NULL,
  embedding bytea NOT NULL,
  image_sha256 varchar(64) NOT NULL,
  quality_score double precision NOT NULL CHECK (quality_score >= 0 AND quality_score <= 1),
  quality_metrics jsonb NOT NULL,
  enrollment_session_id varchar(36) REFERENCES face_enrollment_sessions(id),
  pose_json jsonb,
  collected_at timestamp NOT NULL,
  active boolean NOT NULL DEFAULT true,
  deactivated_at timestamp,
  deactivation_reason varchar(255),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT uq_face_template_image UNIQUE(employee_id, image_sha256)
);

CREATE TABLE IF NOT EXISTS attendance_records (
  id varchar(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  employee_id varchar(36) NOT NULL REFERENCES employees(id),
  worksite_id varchar(36) NOT NULL REFERENCES worksites(id),
  device_id varchar(36) REFERENCES capture_devices(id),
  punch_type punchtype NOT NULL,
  status attendancestatus NOT NULL,
  occurred_at timestamp NOT NULL DEFAULT now(),
  latitude double precision,
  longitude double precision,
  similarity_score double precision,
  liveness_score double precision,
  quality_score double precision,
  confidence_score double precision,
  offline_batch_id varchar(80),
  notes text,
  metadata_json jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS suspicious_attempts (
  id varchar(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  employee_id varchar(36) REFERENCES employees(id),
  worksite_id varchar(36) REFERENCES worksites(id),
  device_id varchar(36) REFERENCES capture_devices(id),
  fraud_type fraudtype NOT NULL,
  severity alertseverity NOT NULL,
  confidence_score double precision,
  evidence_uri varchar(255),
  details jsonb,
  resolved_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id varchar(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  actor_user_id varchar(36) REFERENCES users(id),
  action varchar(120) NOT NULL,
  entity varchar(80),
  entity_id varchar(36),
  ip_address varchar(80),
  user_agent varchar(255),
  metadata_json jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_employees_registration ON employees(registration);
CREATE INDEX IF NOT EXISTS ix_employees_name ON employees(name);
CREATE INDEX IF NOT EXISTS ix_attendance_employee_date ON attendance_records(employee_id, occurred_at);
CREATE INDEX IF NOT EXISTS ix_attendance_worksite_date ON attendance_records(worksite_id, occurred_at);
CREATE INDEX IF NOT EXISTS ix_face_enrollment_sessions_employee_id ON face_enrollment_sessions(employee_id);
CREATE INDEX IF NOT EXISTS ix_face_enrollment_sessions_expires_at ON face_enrollment_sessions(expires_at);
CREATE INDEX IF NOT EXISTS ix_face_templates_enrollment_session_id ON face_templates(enrollment_session_id);
CREATE INDEX IF NOT EXISTS ix_face_template_compatibility_active ON face_templates(model_name, model_version, embedding_dimension, active);
CREATE INDEX IF NOT EXISTS ix_audit_action_created ON audit_logs(action, created_at);
