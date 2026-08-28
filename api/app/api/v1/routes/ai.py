from datetime import datetime

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_scopes
from app.core.config import settings
from app.core.errors import AppError
from app.core.permissions import Scope
from app.db.session import get_session
from app.models.entities import Employee, EmployeeWorksite, FaceTemplate
from app.schemas.auth import UserRead
from app.models.enums import EmployeeStatus
from app.schemas.ai import (
    FaceAnalyzeRequest,
    FaceAnalyzeResponse,
    FaceBoxResponse,
    FaceCapabilitiesResponse,
    FaceIdentifyBatchRequest,
    FaceIdentifyBatchResponse,
    FaceIdentifyRequest,
    FaceIdentifyResponse,
    FaceLandmarkResponse,
    FacePoseResponse,
    FaceQualityMetricsResponse,
    FaceQualityReportResponse,
    FaceTemplateVersionInvalidateRequest,
    FaceTemplateVersionInvalidateResponse,
    FaceTemplateVersionResponse,
    FaceTimingsResponse,
    FaceVerifyRequest,
    FaceVerifyResponse,
)
from app.services.ai.facial_service import (
    FaceEmbeddingService,
    ProcessedFace,
    TemplateCandidate,
    face_match_confidence_score,
    face_match_margin,
    get_face_provider,
    is_face_match_ambiguous,
    rank_identity_candidates,
)
from app.services.ai.image_validation import FaceImageValidator
from app.services.enrollment import ENROLLMENT_POSES

router = APIRouter()


def _request_id(request: Request) -> str:
    return str(getattr(request.state, "request_id", "unknown"))


def _analysis_response(request: Request, processed: ProcessedFace) -> FaceAnalyzeResponse:
    inference = processed.inference
    quality = processed.quality
    box = inference.bounding_box
    pose = inference.pose
    return FaceAnalyzeResponse(
        request_id=_request_id(request),
        accepted=quality.accepted,
        face_count=inference.face_count,
        landmark_count=len(inference.landmarks),
        quality_score=quality.quality_score,
        detection_score=inference.detection_score,
        pose=(
            FacePoseResponse(
                yaw=pose.yaw,
                pitch=pose.pitch,
                roll=pose.roll,
                method=pose.method,
            )
            if pose
            else None
        ),
        face_box=(
            FaceBoxResponse(
                x=box.x,
                y=box.y,
                width=box.width,
                height=box.height,
                source_width=processed.image.width,
                source_height=processed.image.height,
            )
            if box
            else None
        ),
        landmarks=[
            FaceLandmarkResponse(x=point.x, y=point.y) for point in inference.landmarks
        ],
        reasons=[reason.value for reason in quality.reasons],
        liveness_evaluated=False,
        liveness_score=None,
        model_name=inference.model_name,
        model_version=inference.model_version,
        detector_name=inference.detector_name,
        normalization_version=inference.normalization_version,
        execution_provider=inference.execution_provider,
        embedding_dimension=inference.embedding_dimension,
        quality=FaceQualityReportResponse(
            accepted=quality.accepted,
            score=quality.quality_score,
            reasons=[reason.value for reason in quality.reasons],
            metrics=FaceQualityMetricsResponse.model_validate(quality.metrics),
            threshold_profile=quality.threshold_profile,
            thresholds_calibrated=quality.thresholds_calibrated,
            limitations=quality.limitations,
        ),
        timings=FaceTimingsResponse(
            inference_ms=inference.inference_ms,
            total_ms=processed.total_ms,
        ),
    )


@router.get("/capabilities", response_model=FaceCapabilitiesResponse)
async def face_capabilities() -> FaceCapabilitiesResponse:
    provider_info = get_face_provider().info()
    return FaceCapabilitiesResponse(
        provider_state=provider_info.state.value,
        provider_ready=provider_info.state.value == "READY" and provider_info.is_real_model,
        real_model=provider_info.is_real_model,
        model_name=provider_info.model_name,
        model_version=provider_info.model_version,
        detector_name=provider_info.detector_name,
        execution_provider=provider_info.execution_provider,
        embedding_dimension=provider_info.embedding_dimension,
        maximum_image_bytes=settings.FACE_MAX_IMAGE_BYTES,
        minimum_image_width=settings.FACE_MIN_IMAGE_WIDTH,
        minimum_image_height=settings.FACE_MIN_IMAGE_HEIGHT,
        allowed_mime_types=sorted(FaceImageValidator.allowed_formats.values()),
        enrollment_minimum_images=settings.FACE_ENROLLMENT_MIN_IMAGES,
        enrollment_required_poses=[pose.value for pose in ENROLLMENT_POSES],
        enrollment_minimum_frames_per_pose=settings.FACE_ENROLLMENT_MIN_FRAMES_PER_POSE,
        enrollment_maximum_frames_per_pose=settings.FACE_ENROLLMENT_MAX_FRAMES_PER_POSE,
        enrollment_minimum_burst_span_ms=settings.FACE_ENROLLMENT_MIN_BURST_SPAN_MS,
        threshold_profile=settings.FACE_THRESHOLD_PROFILE,
        thresholds_calibrated=settings.FACE_THRESHOLDS_CALIBRATED,
        liveness_available=False,
        limitations=[
            "Liveness temporal/challenge-response ainda nao esta disponivel nesta sprint.",
            "Thresholds biometricos permanecem bloqueados para producao ate calibracao.",
        ],
    )


@router.post("/analyze-face", response_model=FaceAnalyzeResponse)
async def analyze_face(payload: FaceAnalyzeRequest, request: Request) -> FaceAnalyzeResponse:
    processed = FaceEmbeddingService().from_image_base64(payload.image_base64)
    return _analysis_response(request, processed)


@router.post("/identify-face", response_model=FaceIdentifyResponse)
async def identify_face(
    payload: FaceIdentifyRequest,
    request: Request,
    _: UserRead = Depends(require_scopes(Scope.ATTENDANCE_WRITE)),
    session: AsyncSession = Depends(get_session),
) -> FaceIdentifyResponse:
    processed = FaceEmbeddingService().from_image_base64(payload.image_base64)
    analysis = _analysis_response(request, processed)
    inference = processed.inference
    if not processed.quality.accepted or inference.embedding is None:
        return FaceIdentifyResponse(**analysis.model_dump(), matched=False)

    statement = (
        select(FaceTemplate, Employee)
        .join(Employee, FaceTemplate.employee_id == Employee.id)
        .where(
            FaceTemplate.active.is_(True),
            Employee.status == EmployeeStatus.ACTIVE,
            FaceTemplate.model_name == inference.model_name,
            FaceTemplate.model_version == inference.model_version,
            FaceTemplate.embedding_dimension == inference.embedding_dimension,
            FaceTemplate.detector_name == inference.detector_name,
            FaceTemplate.normalization_version == inference.normalization_version,
        )
    )
    if payload.worksite_id:
        now = datetime.utcnow()
        statement = statement.join(
            EmployeeWorksite,
            EmployeeWorksite.employee_id == Employee.id,
        ).where(
            EmployeeWorksite.worksite_id == payload.worksite_id,
            EmployeeWorksite.active.is_(True),
            or_(EmployeeWorksite.starts_at.is_(None), EmployeeWorksite.starts_at <= now),
            or_(EmployeeWorksite.ends_at.is_(None), EmployeeWorksite.ends_at >= now),
        )
    templates = (await session.execute(statement)).all()
    employees_by_id: dict[str, Employee] = {}
    candidates_by_employee: dict[str, list[TemplateCandidate]] = {}

    expected_blob_size = int(inference.embedding_dimension or 0) * 4
    for template, employee in templates:
        if len(template.embedding) != expected_blob_size:
            continue
        employees_by_id[employee.id] = employee
        candidates_by_employee.setdefault(employee.id, []).append(
            TemplateCandidate(
                template_id=template.id,
                embedding=template.embedding,
                quality_score=template.quality_score,
            )
        )

    ranked = rank_identity_candidates(inference.embedding, candidates_by_employee)
    best_match = ranked[0] if ranked else None
    second_best_score = ranked[1].score if len(ranked) > 1 else None
    best_employee = employees_by_id.get(best_match.employee_id) if best_match else None
    best_score = best_match.score if best_match else 0.0
    confidence_score = (
        face_match_confidence_score(best_score, second_best_score) if best_match else 0.0
    )
    margin = face_match_margin(best_score, second_best_score)

    def rejected(reason: str) -> FaceIdentifyResponse:
        response_payload = analysis.model_dump()
        response_payload["reasons"] = [*analysis.reasons, reason]
        return FaceIdentifyResponse(
            **response_payload,
            matched=False,
            similarity_score=round(best_score, 4),
            second_best_similarity_score=(
                round(second_best_score, 4) if second_best_score is not None else None
            ),
            match_margin=margin,
            match_confidence_score=confidence_score,
            candidate_count=len(ranked),
            templates_used=best_match.template_count if best_match else 0,
            centroid_score=(round(best_match.centroid_score, 4) if best_match else None),
            robust_score=(round(best_match.robust_score, 4) if best_match else None),
        )

    if not candidates_by_employee:
        return rejected("NO_COMPATIBLE_TEMPLATES")
    if not best_employee or best_score < settings.FACE_MIN_SIMILARITY:
        return rejected("LOW_SIMILARITY")
    if is_face_match_ambiguous(best_score, second_best_score):
        return rejected("AMBIGUOUS_FACE")

    return FaceIdentifyResponse(
        **analysis.model_dump(),
        matched=True,
        employee_id=best_employee.id,
        employee_name=best_employee.name,
        employee_registration=best_employee.registration,
        employee_photo_url=best_employee.photo_url,
        similarity_score=round(best_score, 4),
        second_best_similarity_score=(
            round(second_best_score, 4) if second_best_score is not None else None
        ),
        match_margin=margin,
        match_confidence_score=confidence_score,
        candidate_count=len(ranked),
        templates_used=best_match.template_count,
        centroid_score=round(best_match.centroid_score, 4),
        robust_score=round(best_match.robust_score, 4),
    )


@router.post("/identify-faces", response_model=FaceIdentifyBatchResponse)
async def identify_faces(
    payload: FaceIdentifyBatchRequest,
    request: Request,
    user: UserRead = Depends(require_scopes(Scope.ATTENDANCE_WRITE)),
    session: AsyncSession = Depends(get_session),
) -> FaceIdentifyBatchResponse:
    """Processa todos os recortes de um quadro na mesma conexão autenticada."""
    results = [
        await identify_face(
            FaceIdentifyRequest(image_base64=image, worksite_id=payload.worksite_id),
            request,
            user,
            session,
        )
        for image in payload.images_base64
    ]
    return FaceIdentifyBatchResponse(results=results)


@router.post("/verify-face", response_model=FaceVerifyResponse)
async def verify_face(
    payload: FaceVerifyRequest,
    request: Request,
    _: UserRead = Depends(require_scopes(Scope.ATTENDANCE_WRITE)),
    session: AsyncSession = Depends(get_session),
) -> FaceVerifyResponse:
    employee = await session.get(Employee, payload.employee_id)
    if not employee:
        raise AppError("EMPLOYEE_NOT_FOUND", "Funcionario nao encontrado", 404)

    processed = FaceEmbeddingService().from_image_base64(payload.image_base64)
    analysis = _analysis_response(request, processed)
    inference = processed.inference

    def rejected(reason: str, match=None) -> FaceVerifyResponse:
        response_payload = analysis.model_dump()
        response_payload["reasons"] = [*analysis.reasons, reason]
        score = match.score if match else 0.0
        return FaceVerifyResponse(
            **response_payload,
            verified=False,
            employee_id=employee.id,
            employee_name=employee.name,
            employee_registration=employee.registration,
            employee_photo_url=employee.photo_url,
            similarity_score=round(score, 4),
            match_confidence_score=(
                face_match_confidence_score(score) if match else 0.0
            ),
            templates_used=match.template_count if match else 0,
            centroid_score=round(match.centroid_score, 4) if match else None,
            robust_score=round(match.robust_score, 4) if match else None,
        )

    if not processed.quality.accepted or inference.embedding is None:
        return rejected("FACE_QUALITY_REJECTED")

    statement = select(FaceTemplate).where(
        FaceTemplate.employee_id == employee.id,
        FaceTemplate.active.is_(True),
        FaceTemplate.model_name == inference.model_name,
        FaceTemplate.model_version == inference.model_version,
        FaceTemplate.embedding_dimension == inference.embedding_dimension,
        FaceTemplate.detector_name == inference.detector_name,
        FaceTemplate.normalization_version == inference.normalization_version,
    )
    expected_blob_size = int(inference.embedding_dimension or 0) * 4
    templates = [
        template
        for template in await session.scalars(statement)
        if len(template.embedding) == expected_blob_size
    ]
    candidates = {
        employee.id: [
            TemplateCandidate(template.id, template.embedding, template.quality_score)
            for template in templates
        ]
    }
    ranked = rank_identity_candidates(inference.embedding, candidates)
    if not ranked:
        return rejected("NO_COMPATIBLE_TEMPLATES")
    match = ranked[0]
    if employee.status != EmployeeStatus.ACTIVE:
        return rejected("INACTIVE_EMPLOYEE", match)
    if match.score < settings.FACE_MIN_SIMILARITY:
        return rejected("LOW_SIMILARITY", match)
    return FaceVerifyResponse(
        **analysis.model_dump(),
        verified=True,
        employee_id=employee.id,
        employee_name=employee.name,
        employee_registration=employee.registration,
        employee_photo_url=employee.photo_url,
        similarity_score=round(match.score, 4),
        match_confidence_score=face_match_confidence_score(match.score),
        templates_used=match.template_count,
        centroid_score=round(match.centroid_score, 4),
        robust_score=round(match.robust_score, 4),
    )


@router.get("/template-versions", response_model=list[FaceTemplateVersionResponse])
async def list_template_versions(
    _: UserRead = Depends(require_scopes(Scope.EMPLOYEES_READ)),
    session: AsyncSession = Depends(get_session),
) -> list[FaceTemplateVersionResponse]:
    statement = (
        select(
            FaceTemplate.model_name,
            FaceTemplate.model_version,
            FaceTemplate.embedding_dimension,
            FaceTemplate.detector_name,
            FaceTemplate.normalization_version,
            func.count(FaceTemplate.id),
            func.count(func.distinct(FaceTemplate.employee_id)),
        )
        .where(FaceTemplate.active.is_(True))
        .group_by(
            FaceTemplate.model_name,
            FaceTemplate.model_version,
            FaceTemplate.embedding_dimension,
            FaceTemplate.detector_name,
            FaceTemplate.normalization_version,
        )
    )
    provider = get_face_provider().info()
    rows = (await session.execute(statement)).all()
    return [
        FaceTemplateVersionResponse(
            model_name=row[0],
            model_version=row[1],
            embedding_dimension=row[2],
            detector_name=row[3],
            normalization_version=row[4],
            active_templates=row[5],
            employees=row[6],
            compatible_with_current_provider=(
                row[0] == provider.model_name
                and row[1] == provider.model_version
                and row[2] == provider.embedding_dimension
                and row[3] == provider.detector_name
                and row[4] == provider.normalization_version
            ),
        )
        for row in rows
    ]


@router.post(
    "/template-versions/invalidate",
    response_model=FaceTemplateVersionInvalidateResponse,
)
async def invalidate_template_version(
    payload: FaceTemplateVersionInvalidateRequest,
    _: UserRead = Depends(require_scopes(Scope.EMPLOYEES_WRITE)),
    session: AsyncSession = Depends(get_session),
) -> FaceTemplateVersionInvalidateResponse:
    conditions = (
        FaceTemplate.active.is_(True),
        FaceTemplate.model_name == payload.model_name,
        FaceTemplate.model_version == payload.model_version,
        FaceTemplate.embedding_dimension == payload.embedding_dimension,
        FaceTemplate.detector_name == payload.detector_name,
        FaceTemplate.normalization_version == payload.normalization_version,
    )
    employee_ids = list(
        await session.scalars(
            select(FaceTemplate.employee_id).where(*conditions).distinct()
        )
    )
    now = datetime.utcnow()
    result = await session.execute(
        update(FaceTemplate)
        .where(*conditions)
        .values(
            active=False,
            deactivated_at=now,
            deactivation_reason=payload.reason,
        )
    )
    if employee_ids:
        await session.execute(
            update(Employee)
            .where(Employee.id.in_(employee_ids))
            .values(
                biometric_reenrollment_required=True,
                biometric_reenrollment_reason=payload.reason,
            )
        )
    await session.commit()
    return FaceTemplateVersionInvalidateResponse(
        templates_invalidated=int(result.rowcount or 0),
        employees_marked_for_reenrollment=len(employee_ids),
        reason=payload.reason,
    )
