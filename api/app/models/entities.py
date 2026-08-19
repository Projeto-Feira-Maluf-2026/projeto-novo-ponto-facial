from datetime import datetime
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from app.models.enums import (
    AlertSeverity,
    AttendanceStatus,
    DeviceStatus,
    EmployeeStatus,
    EnrollmentSessionStatus,
    EnrollmentState,
    FraudType,
    PunchType,
)


class Base(DeclarativeBase):
    pass


def new_uuid() -> str:
    return str(uuid4())


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )


class Department(Base, TimestampMixin):
    __tablename__ = "departments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)


class JobRole(Base, TimestampMixin):
    __tablename__ = "job_roles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)


class Worksite(Base, TimestampMixin):
    __tablename__ = "worksites"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    code: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    address: Mapped[str] = mapped_column(String(255), nullable=False)
    manager_name: Mapped[str | None] = mapped_column(String(160))
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    employees: Mapped[list["EmployeeWorksite"]] = relationship(back_populates="worksite")
    devices: Mapped[list["CaptureDevice"]] = relationship(back_populates="worksite")


class Employee(Base, TimestampMixin):
    __tablename__ = "employees"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    registration: Mapped[str] = mapped_column(String(40), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    document_encrypted: Mapped[str | None] = mapped_column(String(512))
    phone_encrypted: Mapped[str | None] = mapped_column(String(512))
    email: Mapped[str | None] = mapped_column(String(190))
    department_id: Mapped[str | None] = mapped_column(ForeignKey("departments.id"))
    job_role_id: Mapped[str | None] = mapped_column(ForeignKey("job_roles.id"))
    status: Mapped[EmployeeStatus] = mapped_column(
        Enum(EmployeeStatus),
        default=EmployeeStatus.ACTIVE,
        nullable=False,
    )
    consent_biometric_at: Mapped[datetime | None] = mapped_column(DateTime)
    biometric_reenrollment_required: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )
    biometric_reenrollment_reason: Mapped[str | None] = mapped_column(String(255))
    photo_url: Mapped[str | None] = mapped_column(String(255))

    department: Mapped[Department | None] = relationship()
    job_role: Mapped[JobRole | None] = relationship()
    worksites: Mapped[list["EmployeeWorksite"]] = relationship(back_populates="employee")
    face_templates: Mapped[list["FaceTemplate"]] = relationship(back_populates="employee")
    face_enrollment_sessions: Mapped[list["FaceEnrollmentSession"]] = relationship(
        back_populates="employee"
    )
    attendance_records: Mapped[list["AttendanceRecord"]] = relationship(back_populates="employee")


class EmployeeWorksite(Base, TimestampMixin):
    __tablename__ = "employee_worksites"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    employee_id: Mapped[str] = mapped_column(ForeignKey("employees.id"), nullable=False)
    worksite_id: Mapped[str] = mapped_column(ForeignKey("worksites.id"), nullable=False)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    employee: Mapped[Employee] = relationship(back_populates="worksites")
    worksite: Mapped[Worksite] = relationship(back_populates="employees")

    __table_args__ = (UniqueConstraint("employee_id", "worksite_id", name="uq_employee_worksite"),)


class CaptureDevice(Base, TimestampMixin):
    __tablename__ = "capture_devices"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    worksite_id: Mapped[str] = mapped_column(ForeignKey("worksites.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    serial_number: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    api_key_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[DeviceStatus] = mapped_column(Enum(DeviceStatus), default=DeviceStatus.ACTIVE)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime)
    metadata_json: Mapped[dict | None] = mapped_column(JSON)

    worksite: Mapped[Worksite] = relationship(back_populates="devices")


class FaceEnrollmentSession(Base, TimestampMixin):
    __tablename__ = "face_enrollment_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    employee_id: Mapped[str] = mapped_column(ForeignKey("employees.id"), nullable=False, index=True)
    status: Mapped[EnrollmentSessionStatus] = mapped_column(
        Enum(EnrollmentSessionStatus),
        default=EnrollmentSessionStatus.ACTIVE,
        nullable=False,
    )
    state: Mapped[EnrollmentState] = mapped_column(
        Enum(EnrollmentState),
        default=EnrollmentState.ALIGN_FACE,
        nullable=False,
    )
    required_poses: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    capture_summaries: Mapped[list[dict]] = mapped_column(JSON, default=list, nullable=False)
    model_name: Mapped[str] = mapped_column(String(120), nullable=False)
    model_version: Mapped[str] = mapped_column(String(120), nullable=False)
    embedding_dimension: Mapped[int] = mapped_column(Integer, nullable=False)
    detector_name: Mapped[str] = mapped_column(String(120), nullable=False)
    normalization_version: Mapped[str] = mapped_column(String(120), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime)
    failure_code: Mapped[str | None] = mapped_column(String(80))
    failure_details: Mapped[dict | None] = mapped_column(JSON)

    employee: Mapped[Employee] = relationship(back_populates="face_enrollment_sessions")
    templates: Mapped[list["FaceTemplate"]] = relationship(back_populates="enrollment_session")

    __table_args__ = (
        CheckConstraint("embedding_dimension > 0", name="ck_enrollment_embedding_dimension"),
    )


class FaceTemplate(Base, TimestampMixin):
    __tablename__ = "face_templates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    employee_id: Mapped[str] = mapped_column(ForeignKey("employees.id"), nullable=False, index=True)
    model_name: Mapped[str] = mapped_column(String(80), nullable=False)
    model_version: Mapped[str] = mapped_column(String(80), nullable=False)
    embedding_dimension: Mapped[int] = mapped_column(Integer, nullable=False)
    detector_name: Mapped[str] = mapped_column(String(120), nullable=False)
    normalization_version: Mapped[str] = mapped_column(String(120), nullable=False)
    embedding: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    image_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    quality_score: Mapped[float] = mapped_column(Float, nullable=False)
    quality_metrics: Mapped[dict] = mapped_column(JSON, nullable=False)
    enrollment_session_id: Mapped[str | None] = mapped_column(
        ForeignKey("face_enrollment_sessions.id"),
        index=True,
    )
    pose_json: Mapped[dict | None] = mapped_column(JSON)
    collected_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    deactivated_at: Mapped[datetime | None] = mapped_column(DateTime)
    deactivation_reason: Mapped[str | None] = mapped_column(String(255))

    employee: Mapped[Employee] = relationship(back_populates="face_templates")
    enrollment_session: Mapped[FaceEnrollmentSession | None] = relationship(
        back_populates="templates"
    )

    __table_args__ = (
        UniqueConstraint("employee_id", "image_sha256", name="uq_face_template_image"),
        Index(
            "ix_face_template_compatibility_active",
            "model_name",
            "model_version",
            "embedding_dimension",
            "active",
        ),
        CheckConstraint("embedding_dimension > 0", name="ck_face_template_embedding_dimension"),
        CheckConstraint(
            "quality_score >= 0 AND quality_score <= 1",
            name="ck_face_template_quality_score",
        ),
    )


class AttendanceRecord(Base, TimestampMixin):
    __tablename__ = "attendance_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    employee_id: Mapped[str] = mapped_column(ForeignKey("employees.id"), nullable=False, index=True)
    worksite_id: Mapped[str] = mapped_column(ForeignKey("worksites.id"), nullable=False, index=True)
    device_id: Mapped[str | None] = mapped_column(ForeignKey("capture_devices.id"))
    punch_type: Mapped[PunchType] = mapped_column(Enum(PunchType), nullable=False)
    status: Mapped[AttendanceStatus] = mapped_column(Enum(AttendanceStatus), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    similarity_score: Mapped[float | None] = mapped_column(Float)
    liveness_score: Mapped[float | None] = mapped_column(Float)
    quality_score: Mapped[float | None] = mapped_column(Float)
    confidence_score: Mapped[float | None] = mapped_column(Float)
    offline_batch_id: Mapped[str | None] = mapped_column(String(80), index=True)
    notes: Mapped[str | None] = mapped_column(Text)
    metadata_json: Mapped[dict | None] = mapped_column(JSON)

    employee: Mapped[Employee] = relationship(back_populates="attendance_records")
    worksite: Mapped[Worksite] = relationship()
    device: Mapped[CaptureDevice | None] = relationship()

    __table_args__ = (
        Index("ix_attendance_employee_date", "employee_id", "occurred_at"),
        Index("ix_attendance_worksite_date", "worksite_id", "occurred_at"),
    )


class SuspiciousAttempt(Base, TimestampMixin):
    __tablename__ = "suspicious_attempts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    employee_id: Mapped[str | None] = mapped_column(ForeignKey("employees.id"), index=True)
    worksite_id: Mapped[str | None] = mapped_column(ForeignKey("worksites.id"), index=True)
    device_id: Mapped[str | None] = mapped_column(ForeignKey("capture_devices.id"))
    fraud_type: Mapped[FraudType] = mapped_column(Enum(FraudType), nullable=False)
    severity: Mapped[AlertSeverity] = mapped_column(Enum(AlertSeverity), nullable=False)
    confidence_score: Mapped[float | None] = mapped_column(Float)
    evidence_uri: Mapped[str | None] = mapped_column(String(255))
    details: Mapped[dict | None] = mapped_column(JSON)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    actor_user_id: Mapped[str | None] = mapped_column(String(36))
    action: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    entity: Mapped[str | None] = mapped_column(String(80))
    entity_id: Mapped[str | None] = mapped_column(String(36))
    ip_address: Mapped[str | None] = mapped_column(String(80))
    user_agent: Mapped[str | None] = mapped_column(String(255))
    metadata_json: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (Index("ix_audit_action_created", "action", "created_at"),)
