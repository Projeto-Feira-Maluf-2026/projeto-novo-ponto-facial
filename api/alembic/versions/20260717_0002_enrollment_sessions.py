"""Guided enrollment sessions and versioned template metadata.

Revision ID: 20260717_0002
Revises: 20260717_0001
Create Date: 2026-07-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260717_0002"
down_revision: str | None = "20260717_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

enrollment_status = sa.Enum(
    "ACTIVE",
    "COMPLETED",
    "FAILED",
    "CANCELLED",
    "EXPIRED",
    name="enrollmentsessionstatus",
)
enrollment_state = sa.Enum(
    "WAITING_FACE",
    "ALIGN_FACE",
    "MOVE_CLOSER",
    "MOVE_AWAY",
    "IMPROVE_LIGHTING",
    "LOOK_FORWARD",
    "TURN_LEFT",
    "TURN_RIGHT",
    "LOOK_UP",
    "HOLD_STILL",
    "CAPTURED",
    "DUPLICATE_CAPTURE",
    "COMPLETED",
    "FAILED",
    name="enrollmentstate",
)


def upgrade() -> None:
    op.add_column(
        "employees",
        sa.Column(
            "biometric_reenrollment_required",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
    )
    op.add_column(
        "employees",
        sa.Column("biometric_reenrollment_reason", sa.String(length=255), nullable=True),
    )

    op.create_table(
        "face_enrollment_sessions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("employee_id", sa.String(length=36), nullable=False),
        sa.Column("status", enrollment_status, nullable=False),
        sa.Column("state", enrollment_state, nullable=False),
        sa.Column("required_poses", sa.JSON(), nullable=False),
        sa.Column("capture_summaries", sa.JSON(), nullable=False),
        sa.Column("model_name", sa.String(length=120), nullable=False),
        sa.Column("model_version", sa.String(length=120), nullable=False),
        sa.Column("embedding_dimension", sa.Integer(), nullable=False),
        sa.Column("detector_name", sa.String(length=120), nullable=False),
        sa.Column("normalization_version", sa.String(length=120), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(), nullable=True),
        sa.Column("failure_code", sa.String(length=80), nullable=True),
        sa.Column("failure_details", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "embedding_dimension > 0",
            name="ck_enrollment_embedding_dimension",
        ),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_face_enrollment_sessions_employee_id",
        "face_enrollment_sessions",
        ["employee_id"],
        unique=False,
    )
    op.create_index(
        "ix_face_enrollment_sessions_expires_at",
        "face_enrollment_sessions",
        ["expires_at"],
        unique=False,
    )

    op.drop_index("ix_face_template_model_active", table_name="face_templates")
    with op.batch_alter_table("face_templates") as batch:
        batch.add_column(sa.Column("embedding_dimension", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("detector_name", sa.String(length=120), nullable=True))
        batch.add_column(
            sa.Column("normalization_version", sa.String(length=120), nullable=True)
        )
        batch.add_column(sa.Column("quality_metrics", sa.JSON(), nullable=True))
        batch.add_column(
            sa.Column("enrollment_session_id", sa.String(length=36), nullable=True)
        )
        batch.add_column(sa.Column("pose_json", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("collected_at", sa.DateTime(), nullable=True))
        batch.add_column(sa.Column("deactivated_at", sa.DateTime(), nullable=True))
        batch.add_column(
            sa.Column("deactivation_reason", sa.String(length=255), nullable=True)
        )

    templates = sa.table(
        "face_templates",
        sa.column("embedding_dimension", sa.Integer()),
        sa.column("detector_name", sa.String()),
        sa.column("normalization_version", sa.String()),
        sa.column("quality_metrics", sa.JSON()),
        sa.column("collected_at", sa.DateTime()),
        sa.column("created_at", sa.DateTime()),
    )
    op.execute(
        templates.update().values(
            embedding_dimension=512,
            detector_name="legacy-unknown",
            normalization_version="legacy-unknown",
            quality_metrics={"legacy": True, "metrics_available": False},
            collected_at=templates.c.created_at,
        )
    )
    employees = sa.table(
        "employees",
        sa.column("id", sa.String()),
        sa.column("biometric_reenrollment_required", sa.Boolean()),
        sa.column("biometric_reenrollment_reason", sa.String()),
    )
    legacy_employee_ids = sa.select(
        sa.table(
            "face_templates",
            sa.column("employee_id", sa.String()),
            sa.column("active", sa.Boolean()),
        ).c.employee_id
    ).where(sa.text("face_templates.active = true"))
    op.execute(
        employees.update()
        .where(employees.c.id.in_(legacy_employee_ids))
        .values(
            biometric_reenrollment_required=True,
            biometric_reenrollment_reason="LEGACY_TEMPLATE_METADATA_INCOMPLETE",
        )
    )

    with op.batch_alter_table("face_templates") as batch:
        batch.alter_column("embedding_dimension", nullable=False)
        batch.alter_column("detector_name", nullable=False)
        batch.alter_column("normalization_version", nullable=False)
        batch.alter_column("quality_metrics", nullable=False)
        batch.alter_column("collected_at", nullable=False)
        batch.create_foreign_key(
            "fk_face_template_enrollment_session",
            "face_enrollment_sessions",
            ["enrollment_session_id"],
            ["id"],
        )
        batch.create_check_constraint(
            "ck_face_template_embedding_dimension",
            "embedding_dimension > 0",
        )
        batch.create_check_constraint(
            "ck_face_template_quality_score",
            "quality_score >= 0 AND quality_score <= 1",
        )

    op.create_index(
        "ix_face_templates_enrollment_session_id",
        "face_templates",
        ["enrollment_session_id"],
        unique=False,
    )
    op.create_index(
        "ix_face_template_compatibility_active",
        "face_templates",
        ["model_name", "model_version", "embedding_dimension", "active"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_face_template_compatibility_active", table_name="face_templates")
    op.drop_index(
        "ix_face_templates_enrollment_session_id",
        table_name="face_templates",
    )
    with op.batch_alter_table("face_templates") as batch:
        batch.drop_constraint("ck_face_template_quality_score", type_="check")
        batch.drop_constraint("ck_face_template_embedding_dimension", type_="check")
        batch.drop_constraint("fk_face_template_enrollment_session", type_="foreignkey")
        batch.drop_column("deactivation_reason")
        batch.drop_column("deactivated_at")
        batch.drop_column("collected_at")
        batch.drop_column("pose_json")
        batch.drop_column("enrollment_session_id")
        batch.drop_column("quality_metrics")
        batch.drop_column("normalization_version")
        batch.drop_column("detector_name")
        batch.drop_column("embedding_dimension")
    op.create_index(
        "ix_face_template_model_active",
        "face_templates",
        ["model_name", "active"],
        unique=False,
    )

    op.drop_index(
        "ix_face_enrollment_sessions_expires_at",
        table_name="face_enrollment_sessions",
    )
    op.drop_index(
        "ix_face_enrollment_sessions_employee_id",
        table_name="face_enrollment_sessions",
    )
    op.drop_table("face_enrollment_sessions")
    op.drop_column("employees", "biometric_reenrollment_reason")
    op.drop_column("employees", "biometric_reenrollment_required")
