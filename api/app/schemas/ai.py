from pydantic import BaseModel, ConfigDict, Field


class FaceAnalyzeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    image_base64: str = Field(min_length=16)


class FaceIdentifyRequest(FaceAnalyzeRequest):
    worksite_id: str | None = None


class FaceIdentifyBatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    images_base64: list[str] = Field(min_length=1, max_length=5)
    worksite_id: str | None = None


class FaceVerifyRequest(FaceAnalyzeRequest):
    employee_id: str


class FaceBoxResponse(BaseModel):
    x: float
    y: float
    width: float
    height: float
    source_width: int
    source_height: int


class FaceLandmarkResponse(BaseModel):
    x: float
    y: float


class FacePoseResponse(BaseModel):
    yaw: float
    pitch: float
    roll: float
    method: str


class FaceQualityMetricsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    blur_variance: float
    luminance_mean: float
    contrast_stddev: float
    dark_pixel_ratio: float
    bright_pixel_ratio: float
    face_area_ratio: float | None = None
    center_offset: float | None = None
    landmark_visibility_ratio: float | None = None
    yaw_degrees: float | None = None
    pitch_degrees: float | None = None
    roll_degrees: float | None = None
    occlusion_score: float | None = None
    eyes_closed: bool | None = None


class FaceQualityReportResponse(BaseModel):
    accepted: bool
    score: float
    reasons: list[str]
    metrics: FaceQualityMetricsResponse
    threshold_profile: str
    thresholds_calibrated: bool
    limitations: list[str]


class FaceTimingsResponse(BaseModel):
    inference_ms: float
    total_ms: float


class FaceAnalyzeResponse(BaseModel):
    request_id: str
    accepted: bool
    face_count: int
    landmark_count: int
    quality_score: float
    detection_score: float | None = None
    pose: FacePoseResponse | None = None
    face_box: FaceBoxResponse | None = None
    landmarks: list[FaceLandmarkResponse] = Field(default_factory=list)
    reasons: list[str]
    liveness_evaluated: bool = False
    liveness_score: float | None = None
    model_name: str | None = None
    model_version: str | None = None
    detector_name: str | None = None
    normalization_version: str | None = None
    execution_provider: str | None = None
    embedding_dimension: int | None = None
    quality: FaceQualityReportResponse
    timings: FaceTimingsResponse


class FaceIdentifyResponse(FaceAnalyzeResponse):
    matched: bool
    employee_id: str | None = None
    employee_name: str | None = None
    employee_registration: str | None = None
    employee_photo_url: str | None = None
    similarity_score: float | None = None
    second_best_similarity_score: float | None = None
    match_margin: float | None = None
    match_confidence_score: float | None = None
    candidate_count: int = 0
    templates_used: int = 0
    centroid_score: float | None = None
    robust_score: float | None = None
    aggregation_strategy: str = "QUALITY_WEIGHTED_CENTROID_AND_TOP_K_MEDIAN"


class FaceIdentifyBatchResponse(BaseModel):
    results: list[FaceIdentifyResponse]


class FaceVerifyResponse(FaceAnalyzeResponse):
    verified: bool
    employee_id: str
    employee_name: str | None = None
    employee_registration: str | None = None
    employee_photo_url: str | None = None
    similarity_score: float | None = None
    match_confidence_score: float | None = None
    templates_used: int = 0
    centroid_score: float | None = None
    robust_score: float | None = None
    aggregation_strategy: str = "QUALITY_WEIGHTED_CENTROID_AND_TOP_K_MEDIAN"


class FaceCapabilitiesResponse(BaseModel):
    provider_state: str
    provider_ready: bool
    real_model: bool
    model_name: str | None
    model_version: str | None
    detector_name: str | None
    execution_provider: str | None
    embedding_dimension: int | None
    maximum_image_bytes: int
    minimum_image_width: int
    minimum_image_height: int
    allowed_mime_types: list[str]
    enrollment_minimum_images: int
    enrollment_required_poses: list[str]
    enrollment_minimum_frames_per_pose: int
    enrollment_maximum_frames_per_pose: int
    enrollment_minimum_burst_span_ms: int
    threshold_profile: str
    thresholds_calibrated: bool
    liveness_available: bool
    limitations: list[str]


class FaceTemplateVersionResponse(BaseModel):
    model_name: str
    model_version: str
    embedding_dimension: int
    detector_name: str
    normalization_version: str
    active_templates: int
    employees: int
    compatible_with_current_provider: bool
    reprocessable: bool = False


class FaceTemplateVersionInvalidateRequest(BaseModel):
    model_name: str
    model_version: str
    embedding_dimension: int = Field(gt=0)
    detector_name: str
    normalization_version: str
    reason: str = Field(min_length=3, max_length=255)


class FaceTemplateVersionInvalidateResponse(BaseModel):
    templates_invalidated: int
    employees_marked_for_reenrollment: int
    reason: str
