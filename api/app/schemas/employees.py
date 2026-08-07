from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.models.enums import EmployeeStatus
from app.schemas.common import ORMModel


class EmployeeCreate(BaseModel):
    registration: str = Field(min_length=2, max_length=40)
    name: str = Field(min_length=2, max_length=160)
    document: str | None = None
    phone: str | None = None
    email: EmailStr | None = None
    department_id: str | None = None
    job_role_id: str | None = None
    worksite_ids: list[str] = []
    status: EmployeeStatus = EmployeeStatus.ACTIVE


class EmployeeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    document: str | None = None
    phone: str | None = None
    email: EmailStr | None = None
    department_id: str | None = None
    job_role_id: str | None = None
    worksite_ids: list[str] | None = None
    status: EmployeeStatus | None = None


class EmployeeRead(ORMModel):
    id: str
    registration: str
    name: str
    email: str | None
    department_id: str | None
    job_role_id: str | None
    status: EmployeeStatus
    photo_url: str | None
    consent_biometric_at: datetime | None
    biometric_reenrollment_required: bool
    biometric_reenrollment_reason: str | None
    created_at: datetime
    updated_at: datetime


class FaceEnrollmentResponse(BaseModel):
    employee_id: str
    templates_created: int
    model_name: str
    model_version: str
    embedding_dimension: int
    quality_average: float
    threshold_profile: str
    thresholds_calibrated: bool


class FaceEnrollmentRequest(BaseModel):
    images_base64: list[str] = Field(min_length=5, max_length=7)
