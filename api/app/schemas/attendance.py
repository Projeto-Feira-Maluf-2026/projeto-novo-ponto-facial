from datetime import datetime

from pydantic import BaseModel, Field, field_serializer

from app.core.time import utc_isoformat
from app.models.enums import AttendanceStatus, PunchType
from app.schemas.common import ORMModel


class FaceEvidence(BaseModel):
    image_base64: str | None = None
    images_base64: list[str] = Field(default_factory=list, max_length=5)
    embedding: list[float] | None = None
    liveness_score: float | None = Field(
        default=None,
        ge=0,
        le=1,
        deprecated=True,
        description="Ignorado enquanto a API reportar liveness_available=false",
    )
    quality_score: float | None = Field(default=None, ge=0, le=1)
    motion_score: float | None = Field(
        default=None,
        ge=0,
        le=1,
        deprecated=True,
        description="Ignorado enquanto a API reportar liveness_available=false",
    )
    face_count: int = Field(default=1, ge=0)
    spoof_hints: list[str] = Field(
        default_factory=list,
        deprecated=True,
        description="Sinais enviados pelo cliente nao sao confiados pelo servidor",
    )


class PunchCreate(BaseModel):
    employee_id: str | None = None
    worksite_id: str
    device_id: str | None = None
    punch_type: PunchType | None = None
    face: FaceEvidence
    offline_batch_id: str | None = None
    occurred_at: datetime | None = None


class PunchBatchCreate(BaseModel):
    punches: list[PunchCreate] = Field(min_length=1, max_length=5)


class AttendanceCorrection(BaseModel):
    reason: str = Field(min_length=3, max_length=500)
    occurred_at: datetime | None = None
    punch_type: PunchType | None = None
    status: AttendanceStatus | None = None


class AttendanceRead(ORMModel):
    id: str
    employee_id: str
    worksite_id: str
    device_id: str | None
    punch_type: PunchType
    status: AttendanceStatus
    occurred_at: datetime
    latitude: float | None
    longitude: float | None
    similarity_score: float | None
    liveness_score: float | None
    quality_score: float | None
    confidence_score: float | None
    offline_batch_id: str | None
    notes: str | None

    @field_serializer("occurred_at", when_used="json")
    def serialize_occurred_at(self, value: datetime) -> str:
        return utc_isoformat(value)


class AttendanceDecision(BaseModel):
    accepted: bool
    status: AttendanceStatus
    employee_id: str | None
    employee_name: str | None = None
    employee_registration: str | None = None
    employee_photo_url: str | None = None
    punch_type: PunchType | None
    confidence_score: float
    similarity_score: float | None
    second_best_similarity_score: float | None = None
    match_margin: float | None = None
    match_confidence_score: float | None = None
    liveness_evaluated: bool = False
    liveness_score: float | None
    quality_score: float | None
    reasons: list[str]
    temporal_evidence_count: int = 0
    temporal_similarity_median: float | None = None
    record: AttendanceRead | None = None


class AttendanceBatchDecision(BaseModel):
    decisions: list[AttendanceDecision]
    processed: int
    accepted: int
    manual_review: int
