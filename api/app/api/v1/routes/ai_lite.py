from fastapi import APIRouter

from app.core.config import settings
from app.core.errors import AppError
from app.models.enums import EnrollmentPose
from app.schemas.ai import FaceCapabilitiesResponse

router = APIRouter()


@router.get("/capabilities", response_model=FaceCapabilitiesResponse)
async def face_capabilities() -> FaceCapabilitiesResponse:
    return FaceCapabilitiesResponse(
        provider_state="RUNTIME_NOT_INSTALLED",
        provider_ready=False,
        real_model=False,
        model_name=None,
        model_version=None,
        detector_name=None,
        execution_provider=None,
        embedding_dimension=None,
        maximum_image_bytes=settings.FACE_MAX_IMAGE_BYTES,
        minimum_image_width=settings.FACE_MIN_IMAGE_WIDTH,
        minimum_image_height=settings.FACE_MIN_IMAGE_HEIGHT,
        allowed_mime_types=["image/jpeg", "image/png", "image/webp"],
        enrollment_minimum_images=settings.FACE_ENROLLMENT_MIN_IMAGES,
        enrollment_required_poses=[pose.value for pose in EnrollmentPose],
        enrollment_minimum_frames_per_pose=settings.FACE_ENROLLMENT_MIN_FRAMES_PER_POSE,
        enrollment_maximum_frames_per_pose=settings.FACE_ENROLLMENT_MAX_FRAMES_PER_POSE,
        enrollment_minimum_burst_span_ms=settings.FACE_ENROLLMENT_MIN_BURST_SPAN_MS,
        threshold_profile=settings.FACE_THRESHOLD_PROFILE,
        thresholds_calibrated=settings.FACE_THRESHOLDS_CALIBRATED,
        liveness_available=False,
        limitations=[
            "Inferencia facial nao esta instalada na Function serverless leve.",
            "Use o backend de IA em container para matricula e reconhecimento facial.",
        ],
    )


@router.api_route("", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def facial_runtime_unavailable(path: str = "") -> None:
    raise AppError(
        "FACE_RUNTIME_NOT_INSTALLED",
        "Inferencia facial nao esta instalada na Function serverless leve",
        503,
        {"path": path},
    )
