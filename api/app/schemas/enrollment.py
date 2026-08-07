from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.enums import EnrollmentPose, EnrollmentState


class EnrollmentFrameRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    image_base64: str = Field(min_length=16)
    captured_at: datetime

    @model_validator(mode="after")
    def require_timezone(self) -> "EnrollmentFrameRequest":
        if self.captured_at.tzinfo is None:
            raise ValueError("captured_at deve conter timezone explicito")
        return self


class EnrollmentCaptureRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    step_index: int = Field(ge=0, le=4)
    pose: EnrollmentPose
    frames: list[EnrollmentFrameRequest] = Field(min_length=3, max_length=5)


class EnrollmentFinalizeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    captures: list[EnrollmentCaptureRequest] = Field(min_length=5, max_length=5)


class EnrollmentSessionResponse(BaseModel):
    session_id: str
    employee_id: str
    state: EnrollmentState
    expected_pose: EnrollmentPose
    required_poses: list[EnrollmentPose]
    minimum_frames_per_pose: int
    maximum_frames_per_pose: int
    minimum_burst_span_ms: int
    expires_at: datetime
    model_name: str
    model_version: str
    embedding_dimension: int


class EnrollmentCaptureResponse(BaseModel):
    session_id: str
    accepted: bool
    state: EnrollmentState
    step_index: int
    pose: EnrollmentPose
    next_pose: EnrollmentPose | None = None
    instruction: str
    reasons: list[str]
    quality_score: float | None = None
    burst_similarity_median: float | None = None
    observed_yaw: float | None = None
    observed_pitch: float | None = None
    observed_roll: float | None = None


class EnrollmentConsistencyResponse(BaseModel):
    pair_count: int
    minimum_similarity: float
    median_similarity: float
    similarity_stddev: float
    outlier_steps: list[int]


class EnrollmentFinalizeResponse(BaseModel):
    session_id: str
    employee_id: str
    templates_created: int
    model_name: str
    model_version: str
    embedding_dimension: int
    detector_name: str
    normalization_version: str
    quality_average: float
    consistency: EnrollmentConsistencyResponse
    completed_at: datetime


class EnrollmentCancelResponse(BaseModel):
    session_id: str
    state: EnrollmentState
    cancelled_at: datetime
