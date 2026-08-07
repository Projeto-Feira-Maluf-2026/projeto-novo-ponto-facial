"""Initial SQLAlchemy schema.

Revision ID: 20260717_0001
Revises:
Create Date: 2026-07-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260717_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

user_role = sa.Enum(
    "SUPER_ADMIN", "RH", "GESTOR_OBRA", "SUPERVISOR", "FUNCIONARIO", name="userrole"
)
employee_status = sa.Enum("ACTIVE", "INACTIVE", "ON_LEAVE", name="employeestatus")
punch_type = sa.Enum("ENTRY", "LUNCH_OUT", "LUNCH_IN", "EXIT", name="punchtype")
attendance_status = sa.Enum(
    "ACCEPTED", "REJECTED", "MANUAL_REVIEW", "OFFLINE_PENDING", name="attendancestatus"
)
device_status = sa.Enum("ACTIVE", "INACTIVE", "MAINTENANCE", name="devicestatus")
fraud_type = sa.Enum(
    "PRINTED_PHOTO",
    "PHONE_SCREEN",
    "VIDEO_REPLAY",
    "MULTIPLE_FACES",
    "LOW_LIVENESS",
    "LOW_SIMILARITY",
    "OUT_OF_GEOFENCE",
    "UNKNOWN_FACE",
    name="fraudtype",
)
alert_severity = sa.Enum("LOW", "MEDIUM", "HIGH", "CRITICAL", name="alertseverity")


def timestamp_columns() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "departments",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        *timestamp_columns(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_table(
        "job_roles",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        *timestamp_columns(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("email", sa.String(length=190), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("role", user_role, nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        *timestamp_columns(),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_table(
        "worksites",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("code", sa.String(length=40), nullable=False),
        sa.Column("address", sa.String(length=255), nullable=False),
        sa.Column("manager_name", sa.String(length=160), nullable=True),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("geofence_radius_meters", sa.Integer(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        *timestamp_columns(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )
    op.create_table(
        "employees",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("registration", sa.String(length=40), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("document_encrypted", sa.String(length=512), nullable=True),
        sa.Column("phone_encrypted", sa.String(length=512), nullable=True),
        sa.Column("email", sa.String(length=190), nullable=True),
        sa.Column("department_id", sa.String(length=36), nullable=True),
        sa.Column("job_role_id", sa.String(length=36), nullable=True),
        sa.Column("status", employee_status, nullable=False),
        sa.Column("consent_biometric_at", sa.DateTime(), nullable=True),
        sa.Column("photo_url", sa.String(length=255), nullable=True),
        *timestamp_columns(),
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"]),
        sa.ForeignKeyConstraint(["job_role_id"], ["job_roles.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_employees_name", "employees", ["name"], unique=False)
    op.create_index(
        "ix_employees_registration", "employees", ["registration"], unique=True
    )
    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("token_hash", sa.String(length=255), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("device_label", sa.String(length=120), nullable=True),
        *timestamp_columns(),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("ix_refresh_tokens_user_id", "refresh_tokens", ["user_id"], unique=False)
    op.create_table(
        "capture_devices",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("worksite_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("serial_number", sa.String(length=120), nullable=False),
        sa.Column("api_key_hash", sa.String(length=255), nullable=False),
        sa.Column("status", device_status, nullable=False),
        sa.Column("last_seen_at", sa.DateTime(), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        *timestamp_columns(),
        sa.ForeignKeyConstraint(["worksite_id"], ["worksites.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("serial_number"),
    )
    op.create_index(
        "ix_capture_devices_worksite_id", "capture_devices", ["worksite_id"], unique=False
    )
    op.create_table(
        "employee_worksites",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("employee_id", sa.String(length=36), nullable=False),
        sa.Column("worksite_id", sa.String(length=36), nullable=False),
        sa.Column("starts_at", sa.DateTime(), nullable=True),
        sa.Column("ends_at", sa.DateTime(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False),
        *timestamp_columns(),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
        sa.ForeignKeyConstraint(["worksite_id"], ["worksites.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("employee_id", "worksite_id", name="uq_employee_worksite"),
    )
    op.create_table(
        "face_templates",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("employee_id", sa.String(length=36), nullable=False),
        sa.Column("model_name", sa.String(length=80), nullable=False),
        sa.Column("model_version", sa.String(length=80), nullable=False),
        sa.Column("embedding", sa.LargeBinary(), nullable=False),
        sa.Column("image_sha256", sa.String(length=64), nullable=False),
        sa.Column("quality_score", sa.Float(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        *timestamp_columns(),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("employee_id", "image_sha256", name="uq_face_template_image"),
    )
    op.create_index(
        "ix_face_template_model_active",
        "face_templates",
        ["model_name", "active"],
        unique=False,
    )
    op.create_index(
        "ix_face_templates_employee_id", "face_templates", ["employee_id"], unique=False
    )
    op.create_table(
        "attendance_records",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("employee_id", sa.String(length=36), nullable=False),
        sa.Column("worksite_id", sa.String(length=36), nullable=False),
        sa.Column("device_id", sa.String(length=36), nullable=True),
        sa.Column("punch_type", punch_type, nullable=False),
        sa.Column("status", attendance_status, nullable=False),
        sa.Column("occurred_at", sa.DateTime(), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("similarity_score", sa.Float(), nullable=True),
        sa.Column("liveness_score", sa.Float(), nullable=True),
        sa.Column("quality_score", sa.Float(), nullable=True),
        sa.Column("confidence_score", sa.Float(), nullable=True),
        sa.Column("offline_batch_id", sa.String(length=80), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        *timestamp_columns(),
        sa.ForeignKeyConstraint(["device_id"], ["capture_devices.id"]),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
        sa.ForeignKeyConstraint(["worksite_id"], ["worksites.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_attendance_employee_date",
        "attendance_records",
        ["employee_id", "occurred_at"],
        unique=False,
    )
    op.create_index(
        "ix_attendance_records_employee_id",
        "attendance_records",
        ["employee_id"],
        unique=False,
    )
    op.create_index(
        "ix_attendance_records_offline_batch_id",
        "attendance_records",
        ["offline_batch_id"],
        unique=False,
    )
    op.create_index(
        "ix_attendance_records_worksite_id",
        "attendance_records",
        ["worksite_id"],
        unique=False,
    )
    op.create_index(
        "ix_attendance_worksite_date",
        "attendance_records",
        ["worksite_id", "occurred_at"],
        unique=False,
    )
    op.create_table(
        "suspicious_attempts",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("employee_id", sa.String(length=36), nullable=True),
        sa.Column("worksite_id", sa.String(length=36), nullable=True),
        sa.Column("device_id", sa.String(length=36), nullable=True),
        sa.Column("fraud_type", fraud_type, nullable=False),
        sa.Column("severity", alert_severity, nullable=False),
        sa.Column("confidence_score", sa.Float(), nullable=True),
        sa.Column("evidence_uri", sa.String(length=255), nullable=True),
        sa.Column("details", sa.JSON(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        *timestamp_columns(),
        sa.ForeignKeyConstraint(["device_id"], ["capture_devices.id"]),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
        sa.ForeignKeyConstraint(["worksite_id"], ["worksites.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_suspicious_attempts_employee_id",
        "suspicious_attempts",
        ["employee_id"],
        unique=False,
    )
    op.create_index(
        "ix_suspicious_attempts_worksite_id",
        "suspicious_attempts",
        ["worksite_id"],
        unique=False,
    )
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("actor_user_id", sa.String(length=36), nullable=True),
        sa.Column("action", sa.String(length=120), nullable=False),
        sa.Column("entity", sa.String(length=80), nullable=True),
        sa.Column("entity_id", sa.String(length=36), nullable=True),
        sa.Column("ip_address", sa.String(length=80), nullable=True),
        sa.Column("user_agent", sa.String(length=255), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_audit_action_created", "audit_logs", ["action", "created_at"], unique=False
    )
    op.create_index("ix_audit_logs_action", "audit_logs", ["action"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_audit_logs_action", table_name="audit_logs")
    op.drop_index("ix_audit_action_created", table_name="audit_logs")
    op.drop_table("audit_logs")
    op.drop_index("ix_suspicious_attempts_worksite_id", table_name="suspicious_attempts")
    op.drop_index("ix_suspicious_attempts_employee_id", table_name="suspicious_attempts")
    op.drop_table("suspicious_attempts")
    op.drop_index("ix_attendance_worksite_date", table_name="attendance_records")
    op.drop_index("ix_attendance_records_worksite_id", table_name="attendance_records")
    op.drop_index("ix_attendance_records_offline_batch_id", table_name="attendance_records")
    op.drop_index("ix_attendance_records_employee_id", table_name="attendance_records")
    op.drop_index("ix_attendance_employee_date", table_name="attendance_records")
    op.drop_table("attendance_records")
    op.drop_index("ix_face_templates_employee_id", table_name="face_templates")
    op.drop_index("ix_face_template_model_active", table_name="face_templates")
    op.drop_table("face_templates")
    op.drop_table("employee_worksites")
    op.drop_index("ix_capture_devices_worksite_id", table_name="capture_devices")
    op.drop_table("capture_devices")
    op.drop_index("ix_refresh_tokens_user_id", table_name="refresh_tokens")
    op.drop_table("refresh_tokens")
    op.drop_index("ix_employees_registration", table_name="employees")
    op.drop_index("ix_employees_name", table_name="employees")
    op.drop_table("employees")
    op.drop_table("worksites")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
    op.drop_table("job_roles")
    op.drop_table("departments")
