import asyncio
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from itertools import combinations
from statistics import median

import numpy as np
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import AppError, FaceInputError, FaceServiceUnavailableError
from app.models.entities import Employee, FaceEnrollmentSession, FaceTemplate
from app.models.enums import (
    EnrollmentPose,
    EnrollmentSessionStatus,
    EnrollmentState,
)
from app.schemas.enrollment import (
    EnrollmentCancelResponse,
    EnrollmentCaptureRequest,
    EnrollmentCaptureResponse,
    EnrollmentConsistencyResponse,
    EnrollmentFinalizeRequest,
    EnrollmentFinalizeResponse,
    EnrollmentSampleRequest,
    EnrollmentSampleResponse,
    EnrollmentSessionResponse,
)
from app.services.ai.facial_service import (
    FaceEmbeddingService,
    ProcessedFace,
    cosine_similarity,
    deserialize_embedding,
    serialize_embedding,
)
from app.services.ai.image_validation import FaceImageValidator

ENROLLMENT_POSES = [
    EnrollmentPose.FRONTAL,
    EnrollmentPose.TURN_LEFT,
    EnrollmentPose.TURN_RIGHT,
    EnrollmentPose.LOOK_UP,
    EnrollmentPose.FRONTAL_FINAL,
]

PENDING_ENROLLMENT_REASON = "PENDING_AUTOMATIC_ENROLLMENT"
MAX_AUTOMATIC_CANDIDATES = 7


@dataclass(frozen=True)
class ValidatedCapture:
    request: EnrollmentCaptureRequest
    selected: ProcessedFace
    selected_captured_at: datetime
    perceptual_hash: str
    burst_similarity_median: float


def _utc_now_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _as_utc_naive(value: datetime) -> datetime:
    return value.astimezone(UTC).replace(tzinfo=None)


def _pairwise_similarities(
    vectors: list[list[float] | np.ndarray],
) -> list[float]:
    return [
        cosine_similarity(left, right)
        for left, right in combinations(vectors, 2)
    ]


class FaceEnrollmentService:
    def __init__(
        self,
        session: AsyncSession,
        face_service: FaceEmbeddingService | None = None,
    ) -> None:
        self.session = session
        self.face_service = face_service or FaceEmbeddingService()

    async def start(self, employee_id: str) -> EnrollmentSessionResponse:
        employee = await self.session.get(Employee, employee_id)
        if not employee:
            raise AppError("EMPLOYEE_NOT_FOUND", "Funcionario nao encontrado", 404)
        provider = self.face_service.provider.info()
        if not provider.is_real_model and settings.ENVIRONMENT != "test":
            raise FaceServiceUnavailableError(
                "REAL_FACE_MODEL_REQUIRED",
                "Cadastro facial exige um modelo real",
            )
        if provider.state.value != "READY":
            raise FaceServiceUnavailableError(
                provider.state.value,
                provider.failure.message if provider.failure else "Provider facial indisponivel",
            )
        if (
            settings.ENVIRONMENT in {"staging", "production"}
            and not settings.FACE_THRESHOLDS_CALIBRATED
        ):
            raise FaceServiceUnavailableError(
                "THRESHOLDS_NOT_CALIBRATED",
                "Cadastro facial bloqueado sem calibracao aprovada",
            )

        now = _utc_now_naive()
        active_sessions = list(
            await self.session.scalars(
                select(FaceEnrollmentSession).where(
                    FaceEnrollmentSession.employee_id == employee_id,
                    FaceEnrollmentSession.status == EnrollmentSessionStatus.ACTIVE,
                )
            )
        )
        for active in active_sessions:
            active.status = EnrollmentSessionStatus.CANCELLED
            active.state = EnrollmentState.FAILED
            active.cancelled_at = now
            active.failure_code = "SUPERSEDED_BY_NEW_SESSION"
            await self.session.execute(
                delete(FaceTemplate).where(
                    FaceTemplate.enrollment_session_id == active.id,
                    FaceTemplate.active.is_(False),
                    FaceTemplate.deactivation_reason == PENDING_ENROLLMENT_REASON,
                )
            )

        enrollment = FaceEnrollmentSession(
            employee_id=employee_id,
            status=EnrollmentSessionStatus.ACTIVE,
            state=EnrollmentState.ALIGN_FACE,
            required_poses=[pose.value for pose in ENROLLMENT_POSES],
            capture_summaries=[],
            model_name=provider.model_name or "",
            model_version=provider.model_version or "",
            embedding_dimension=int(provider.embedding_dimension or 0),
            detector_name=provider.detector_name or "",
            normalization_version=provider.normalization_version or "",
            expires_at=now + timedelta(seconds=settings.FACE_ENROLLMENT_SESSION_TTL_SECONDS),
        )
        self.session.add(enrollment)
        await self.session.commit()
        await self.session.refresh(enrollment)
        return EnrollmentSessionResponse(
            session_id=enrollment.id,
            employee_id=employee_id,
            state=enrollment.state,
            expected_pose=ENROLLMENT_POSES[0],
            required_poses=ENROLLMENT_POSES,
            minimum_frames_per_pose=settings.FACE_ENROLLMENT_MIN_FRAMES_PER_POSE,
            maximum_frames_per_pose=settings.FACE_ENROLLMENT_MAX_FRAMES_PER_POSE,
            minimum_burst_span_ms=settings.FACE_ENROLLMENT_MIN_BURST_SPAN_MS,
            expires_at=enrollment.expires_at,
            model_name=enrollment.model_name,
            model_version=enrollment.model_version,
            embedding_dimension=enrollment.embedding_dimension,
            collection_mode="AUTOMATIC",
            accepted_samples=0,
            target_samples=settings.FACE_ENROLLMENT_MIN_IMAGES,
            ready=False,
        )

    async def collect_sample(
        self,
        employee_id: str,
        enrollment_id: str,
        payload: EnrollmentSampleRequest,
    ) -> EnrollmentSampleResponse:
        """Evaluate one frame without invalidating previously accepted progress."""
        enrollment = await self._active_session(employee_id, enrollment_id, lock=True)
        processed = await asyncio.to_thread(
            self.face_service.from_image_base64,
            payload.frame.image_base64,
        )
        existing = await self._pending_candidates(enrollment.id)
        reasons = self._automatic_quality_reasons(processed)
        if processed.inference.embedding is None and not reasons:
            reasons = ["EMBEDDING_UNAVAILABLE"]
        metrics = processed.quality.metrics
        pose = processed.inference.pose

        if reasons:
            state, instruction = self._quality_instruction(reasons)
            enrollment.state = state
            await self.session.commit()
            return self._sample_response(
                enrollment,
                existing,
                processed=processed,
                accepted=False,
                state=state,
                instruction=instruction,
                reasons=reasons,
            )
        if (metrics.face_area_ratio or 0.0) > 0.58:
            enrollment.state = EnrollmentState.MOVE_AWAY
            await self.session.commit()
            return self._sample_response(
                enrollment,
                existing,
                processed=processed,
                accepted=False,
                state=EnrollmentState.MOVE_AWAY,
                instruction="Afaste um pouco o rosto da câmera",
                reasons=["FACE_TOO_CLOSE"],
            )

        captured_at = _as_utc_naive(payload.frame.captured_at)
        if existing and captured_at <= max(candidate.collected_at for candidate in existing):
            enrollment.state = EnrollmentState.HOLD_STILL
            await self.session.commit()
            return self._sample_response(
                enrollment,
                existing,
                processed=processed,
                accepted=False,
                state=EnrollmentState.HOLD_STILL,
                instruction="A câmera ainda está estabilizando; mantenha o rosto visível",
                reasons=["NON_MONOTONIC_CAPTURE_TIME"],
            )

        perceptual_hash = FaceImageValidator.perceptual_hash(processed.image.image_bgr)
        exact_image_exists = await self.session.scalar(
            select(FaceTemplate.id).where(
                FaceTemplate.employee_id == employee_id,
                FaceTemplate.image_sha256 == processed.image.sha256,
            )
        )
        duplicate = next(
            (
                candidate
                for candidate in existing
                if FaceImageValidator.perceptual_distance(
                    str((candidate.quality_metrics or {}).get("perceptual_hash", "")),
                    perceptual_hash,
                ) < settings.FACE_ENROLLMENT_MIN_PERCEPTUAL_DISTANCE
            ),
            None,
        )
        if duplicate is not None or exact_image_exists is not None:
            enrollment.state = EnrollmentState.DUPLICATE_CAPTURE
            await self.session.commit()
            return self._sample_response(
                enrollment,
                existing,
                processed=processed,
                accepted=False,
                state=EnrollmentState.DUPLICATE_CAPTURE,
                instruction=self._automatic_instruction(existing, ready=False),
                reasons=["FRAME_TOO_SIMILAR"],
            )

        vector = processed.inference.embedding or []
        similarities = [cosine_similarity(vector, item.embedding) for item in existing]
        if similarities and float(median(similarities)) < settings.FACE_ENROLLMENT_MIN_PAIR_SIMILARITY:
            enrollment.state = EnrollmentState.ALIGN_FACE
            await self.session.commit()
            return self._sample_response(
                enrollment,
                existing,
                processed=processed,
                accepted=False,
                state=EnrollmentState.ALIGN_FACE,
                instruction="Mantenha a mesma pessoa diante da câmera",
                reasons=["IDENTITY_INCONSISTENT_WITH_SESSION"],
            )

        pose_bucket = self._pose_bucket(processed)
        quality_metrics = asdict(metrics)
        quality_metrics.update(
            {
                "perceptual_hash": perceptual_hash,
                "pose_bucket": pose_bucket,
                "processing_ms": processed.total_ms,
                "detection_confidence": processed.inference.detection_score,
            }
        )
        candidate = FaceTemplate(
            employee_id=employee_id,
            model_name=processed.inference.model_name or "",
            model_version=processed.inference.model_version or "",
            embedding_dimension=int(processed.inference.embedding_dimension or 0),
            detector_name=processed.inference.detector_name or "",
            normalization_version=processed.inference.normalization_version or "",
            embedding=serialize_embedding(vector),
            image_sha256=processed.image.sha256,
            quality_score=processed.quality.quality_score,
            quality_metrics=quality_metrics,
            enrollment_session_id=enrollment.id,
            pose_json={
                "bucket": pose_bucket,
                "yaw": pose.yaw if pose else None,
                "pitch": pose.pitch if pose else None,
                "roll": pose.roll if pose else None,
                "method": pose.method if pose else None,
            },
            collected_at=captured_at,
            active=False,
            deactivation_reason=PENDING_ENROLLMENT_REASON,
        )
        self.session.add(candidate)
        await self.session.flush()
        candidates = [*existing, candidate]

        if len(candidates) > MAX_AUTOMATIC_CANDIDATES:
            keep = self._select_final_candidates(candidates, limit=MAX_AUTOMATIC_CANDIDATES)
            keep_ids = {item.id for item in keep}
            discarded = [item for item in candidates if item.id not in keep_ids]
            for item in discarded:
                await self.session.delete(item)
            candidates = keep

        ready = self._automatic_ready(candidates)
        enrollment.capture_summaries = [self._automatic_summary(item) for item in candidates]
        enrollment.state = EnrollmentState.CAPTURED
        await self.session.commit()
        return self._sample_response(
            enrollment,
            candidates,
            processed=processed,
            accepted=True,
            state=EnrollmentState.CAPTURED,
            instruction=self._automatic_instruction(candidates, ready=ready),
            reasons=[],
            sample_id=candidate.id,
        )

    async def validate_capture(
        self,
        employee_id: str,
        enrollment_id: str,
        payload: EnrollmentCaptureRequest,
    ) -> EnrollmentCaptureResponse:
        enrollment = await self._active_session(employee_id, enrollment_id, lock=True)
        summaries = list(enrollment.capture_summaries or [])
        if payload.step_index != len(summaries):
            raise AppError(
                "ENROLLMENT_STEP_OUT_OF_ORDER",
                "A captura nao corresponde a etapa atual",
                409,
                {"expected_step": len(summaries), "received_step": payload.step_index},
            )
        expected_pose = ENROLLMENT_POSES[payload.step_index]
        if payload.pose != expected_pose:
            raise AppError(
                "UNEXPECTED_ENROLLMENT_POSE",
                "A pose enviada nao corresponde a instrucao atual",
                409,
                {"expected_pose": expected_pose.value, "received_pose": payload.pose.value},
            )

        validated, rejection = await self._validate_burst(payload)
        if rejection:
            enrollment.state = rejection.state
            await self.session.commit()
            return EnrollmentCaptureResponse(
                session_id=enrollment.id,
                accepted=False,
                state=rejection.state,
                step_index=payload.step_index,
                pose=payload.pose,
                instruction=rejection.instruction,
                reasons=rejection.reasons,
                quality_score=rejection.quality_score,
                burst_similarity_median=rejection.burst_similarity_median,
                observed_yaw=rejection.observed_yaw,
                observed_pitch=rejection.observed_pitch,
                observed_roll=rejection.observed_roll,
            )
        assert validated is not None

        duplicate_step = next(
            (
                int(summary["step_index"])
                for summary in summaries
                if not self._is_repeat_frontal_pair(
                    payload.pose,
                    EnrollmentPose(str(summary["pose"])),
                )
                if FaceImageValidator.perceptual_distance(
                    str(summary["perceptual_hash"]),
                    validated.perceptual_hash,
                )
                < settings.FACE_ENROLLMENT_MIN_PERCEPTUAL_DISTANCE
            ),
            None,
        )
        if duplicate_step is not None:
            enrollment.state = EnrollmentState.DUPLICATE_CAPTURE
            await self.session.commit()
            pose = validated.selected.inference.pose
            return EnrollmentCaptureResponse(
                session_id=enrollment.id,
                accepted=False,
                state=EnrollmentState.DUPLICATE_CAPTURE,
                step_index=payload.step_index,
                pose=payload.pose,
                instruction="A captura esta muito parecida com uma pose anterior",
                reasons=[f"DUPLICATE_OF_STEP_{duplicate_step}"],
                quality_score=validated.selected.quality.quality_score,
                burst_similarity_median=validated.burst_similarity_median,
                observed_yaw=pose.yaw if pose else None,
                observed_pitch=pose.pitch if pose else None,
                observed_roll=pose.roll if pose else None,
            )
        if summaries:
            previous_at = datetime.fromisoformat(str(summaries[-1]["captured_at"]))
            if _as_utc_naive(validated.selected_captured_at) <= _as_utc_naive(previous_at):
                enrollment.state = EnrollmentState.HOLD_STILL
                await self.session.commit()
                return EnrollmentCaptureResponse(
                    session_id=enrollment.id,
                    accepted=False,
                    state=EnrollmentState.HOLD_STILL,
                    step_index=payload.step_index,
                    pose=payload.pose,
                    instruction="Capture as poses em sequencia, sem reutilizar frames antigos",
                    reasons=["NON_MONOTONIC_CAPTURE_TIME"],
                    quality_score=validated.selected.quality.quality_score,
                    burst_similarity_median=validated.burst_similarity_median,
                )

        pose = validated.selected.inference.pose
        summaries.append(self._capture_summary(validated))
        enrollment.capture_summaries = summaries
        enrollment.state = EnrollmentState.CAPTURED
        await self.session.commit()
        next_pose = (
            ENROLLMENT_POSES[payload.step_index + 1]
            if payload.step_index + 1 < len(ENROLLMENT_POSES)
            else None
        )
        return EnrollmentCaptureResponse(
            session_id=enrollment.id,
            accepted=True,
            state=EnrollmentState.CAPTURED,
            step_index=payload.step_index,
            pose=payload.pose,
            next_pose=next_pose,
            instruction="Captura aceita" if next_pose else "Capturas prontas para finalizar",
            reasons=[],
            quality_score=validated.selected.quality.quality_score,
            burst_similarity_median=validated.burst_similarity_median,
            observed_yaw=pose.yaw if pose else None,
            observed_pitch=pose.pitch if pose else None,
            observed_roll=pose.roll if pose else None,
        )

    async def finalize(
        self,
        employee_id: str,
        enrollment_id: str,
        payload: EnrollmentFinalizeRequest,
    ) -> EnrollmentFinalizeResponse:
        enrollment = await self._active_session(employee_id, enrollment_id, lock=True)
        if not payload.captures:
            return await self._finalize_automatic(employee_id, enrollment)
        if len(enrollment.capture_summaries or []) != len(ENROLLMENT_POSES):
            raise AppError(
                "ENROLLMENT_NOT_READY",
                "Todas as etapas devem ser validadas antes da finalizacao",
                409,
            )
        if [capture.pose for capture in payload.captures] != ENROLLMENT_POSES:
            raise FaceInputError(
                "INVALID_ENROLLMENT_SEQUENCE",
                "A sequencia de poses do cadastro e invalida",
                expected=[pose.value for pose in ENROLLMENT_POSES],
            )
        if [capture.step_index for capture in payload.captures] != list(range(5)):
            raise FaceInputError(
                "INVALID_ENROLLMENT_STEPS",
                "As etapas do cadastro devem ser sequenciais",
            )

        validated_captures: list[ValidatedCapture] = []
        for capture in payload.captures:
            validated, rejection = await self._validate_burst(capture)
            if rejection or validated is None:
                raise FaceInputError(
                    "ENROLLMENT_CAPTURE_REJECTED",
                    "Uma captura deixou de atender aos criterios na finalizacao",
                    step_index=capture.step_index,
                    reasons=rejection.reasons if rejection else [],
                    state=rejection.state.value if rejection else EnrollmentState.FAILED.value,
                )
            validated_captures.append(validated)

        self._validate_model_compatibility(enrollment, validated_captures)
        self._validate_temporal_diversity(validated_captures)
        self._validate_perceptual_diversity(validated_captures)
        consistency = self._consistency(validated_captures)
        if (
            consistency.minimum_similarity < settings.FACE_ENROLLMENT_MIN_PAIR_SIMILARITY
            or consistency.median_similarity
            < settings.FACE_ENROLLMENT_MIN_MEDIAN_SIMILARITY
            or consistency.similarity_stddev
            > settings.FACE_ENROLLMENT_MAX_SIMILARITY_STDDEV
            or consistency.outlier_steps
        ):
            raise FaceInputError(
                "ENROLLMENT_IDENTITY_INCONSISTENT",
                "As capturas nao representam uma identidade facial consistente",
                consistency=consistency.model_dump(),
            )

        employee = await self.session.get(Employee, employee_id)
        if not employee:
            raise AppError("EMPLOYEE_NOT_FOUND", "Funcionario nao encontrado", 404)
        now = _utc_now_naive()
        await self.session.execute(
            update(FaceTemplate)
            .where(FaceTemplate.employee_id == employee_id, FaceTemplate.active.is_(True))
            .values(
                active=False,
                deactivated_at=now,
                deactivation_reason="REPLACED_BY_GUIDED_ENROLLMENT",
            )
        )
        for capture in validated_captures:
            processed = capture.selected
            inference = processed.inference
            pose = inference.pose
            self.session.add(
                FaceTemplate(
                    employee_id=employee_id,
                    model_name=inference.model_name or "",
                    model_version=inference.model_version or "",
                    embedding_dimension=int(inference.embedding_dimension or 0),
                    detector_name=inference.detector_name or "",
                    normalization_version=inference.normalization_version or "",
                    embedding=serialize_embedding(inference.embedding or []),
                    image_sha256=processed.image.sha256,
                    quality_score=processed.quality.quality_score,
                    quality_metrics=asdict(processed.quality.metrics),
                    enrollment_session_id=enrollment.id,
                    pose_json={
                        "expected": capture.request.pose.value,
                        "yaw": pose.yaw if pose else None,
                        "pitch": pose.pitch if pose else None,
                        "roll": pose.roll if pose else None,
                        "method": pose.method if pose else None,
                    },
                    collected_at=_as_utc_naive(capture.selected_captured_at),
                    active=True,
                )
            )

        employee.consent_biometric_at = now
        employee.biometric_reenrollment_required = False
        employee.biometric_reenrollment_reason = None
        enrollment.status = EnrollmentSessionStatus.COMPLETED
        enrollment.state = EnrollmentState.COMPLETED
        enrollment.completed_at = now
        enrollment.capture_summaries = [
            self._capture_summary(capture) for capture in validated_captures
        ]
        try:
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise

        return EnrollmentFinalizeResponse(
            session_id=enrollment.id,
            employee_id=employee_id,
            templates_created=len(validated_captures),
            model_name=enrollment.model_name,
            model_version=enrollment.model_version,
            embedding_dimension=enrollment.embedding_dimension,
            detector_name=enrollment.detector_name,
            normalization_version=enrollment.normalization_version,
            quality_average=round(
                sum(capture.selected.quality.quality_score for capture in validated_captures)
                / len(validated_captures),
                4,
            ),
            consistency=consistency,
            completed_at=now,
        )

    async def _finalize_automatic(
        self,
        employee_id: str,
        enrollment: FaceEnrollmentSession,
    ) -> EnrollmentFinalizeResponse:
        candidates = await self._pending_candidates(enrollment.id)
        if not self._automatic_ready(candidates):
            raise AppError(
                "ENROLLMENT_NOT_READY",
                "Continue por alguns instantes para obter variação facial suficiente",
                409,
                {
                    "accepted_samples": len(candidates),
                    "target_samples": settings.FACE_ENROLLMENT_MIN_IMAGES,
                    "pose_coverage": self._pose_coverage(candidates),
                },
            )
        selected = self._select_final_candidates(
            candidates,
            limit=settings.FACE_ENROLLMENT_MIN_IMAGES,
        )
        vectors = [deserialize_embedding(candidate.embedding) for candidate in selected]
        consistency = self._consistency_from_vectors(vectors)
        if (
            consistency.minimum_similarity < settings.FACE_ENROLLMENT_MIN_PAIR_SIMILARITY
            or consistency.median_similarity < settings.FACE_ENROLLMENT_MIN_MEDIAN_SIMILARITY
            or consistency.similarity_stddev > settings.FACE_ENROLLMENT_MAX_SIMILARITY_STDDEV
            or consistency.outlier_steps
        ):
            raise FaceInputError(
                "ENROLLMENT_IDENTITY_INCONSISTENT",
                "As amostras não representam uma identidade facial consistente",
                consistency=consistency.model_dump(),
            )

        employee = await self.session.get(Employee, employee_id)
        if not employee:
            raise AppError("EMPLOYEE_NOT_FOUND", "Funcionário não encontrado", 404)
        now = _utc_now_naive()
        await self.session.execute(
            update(FaceTemplate)
            .where(
                FaceTemplate.employee_id == employee_id,
                FaceTemplate.active.is_(True),
            )
            .values(
                active=False,
                deactivated_at=now,
                deactivation_reason="REPLACED_BY_AUTOMATIC_ENROLLMENT",
            )
        )
        selected_ids = {candidate.id for candidate in selected}
        for candidate in selected:
            candidate.active = True
            candidate.deactivated_at = None
            candidate.deactivation_reason = None
        await self.session.execute(
            delete(FaceTemplate).where(
                FaceTemplate.enrollment_session_id == enrollment.id,
                FaceTemplate.active.is_(False),
                FaceTemplate.id.not_in(selected_ids),
            )
        )

        employee.consent_biometric_at = now
        employee.biometric_reenrollment_required = False
        employee.biometric_reenrollment_reason = None
        enrollment.status = EnrollmentSessionStatus.COMPLETED
        enrollment.state = EnrollmentState.COMPLETED
        enrollment.completed_at = now
        enrollment.capture_summaries = [self._automatic_summary(item) for item in selected]
        try:
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise

        return EnrollmentFinalizeResponse(
            session_id=enrollment.id,
            employee_id=employee_id,
            templates_created=len(selected),
            model_name=enrollment.model_name,
            model_version=enrollment.model_version,
            embedding_dimension=enrollment.embedding_dimension,
            detector_name=enrollment.detector_name,
            normalization_version=enrollment.normalization_version,
            quality_average=round(
                sum(item.quality_score for item in selected) / len(selected),
                4,
            ),
            consistency=consistency,
            completed_at=now,
        )

    async def cancel(
        self,
        employee_id: str,
        enrollment_id: str,
    ) -> EnrollmentCancelResponse:
        enrollment = await self._active_session(employee_id, enrollment_id, lock=True)
        now = _utc_now_naive()
        enrollment.status = EnrollmentSessionStatus.CANCELLED
        enrollment.state = EnrollmentState.FAILED
        enrollment.cancelled_at = now
        enrollment.failure_code = "CANCELLED_BY_USER"
        await self.session.execute(
            delete(FaceTemplate).where(
                FaceTemplate.enrollment_session_id == enrollment.id,
                FaceTemplate.active.is_(False),
                FaceTemplate.deactivation_reason == PENDING_ENROLLMENT_REASON,
            )
        )
        await self.session.commit()
        return EnrollmentCancelResponse(
            session_id=enrollment.id,
            state=enrollment.state,
            cancelled_at=now,
        )

    async def _active_session(
        self,
        employee_id: str,
        enrollment_id: str,
        *,
        lock: bool,
    ) -> FaceEnrollmentSession:
        statement = select(FaceEnrollmentSession).where(
            FaceEnrollmentSession.id == enrollment_id,
            FaceEnrollmentSession.employee_id == employee_id,
        )
        if lock:
            statement = statement.with_for_update()
        enrollment = await self.session.scalar(statement)
        if not enrollment:
            raise AppError("ENROLLMENT_SESSION_NOT_FOUND", "Sessao nao encontrada", 404)
        if enrollment.status != EnrollmentSessionStatus.ACTIVE:
            raise AppError(
                "ENROLLMENT_SESSION_NOT_ACTIVE",
                "A sessao de cadastro nao esta ativa",
                409,
                {"status": enrollment.status.value},
            )
        now = _utc_now_naive()
        if enrollment.expires_at <= now:
            enrollment.status = EnrollmentSessionStatus.EXPIRED
            enrollment.state = EnrollmentState.FAILED
            enrollment.failure_code = "SESSION_EXPIRED"
            await self.session.execute(
                delete(FaceTemplate).where(
                    FaceTemplate.enrollment_session_id == enrollment.id,
                    FaceTemplate.active.is_(False),
                    FaceTemplate.deactivation_reason == PENDING_ENROLLMENT_REASON,
                )
            )
            await self.session.commit()
            raise AppError("ENROLLMENT_SESSION_EXPIRED", "A sessao expirou", 410)
        provider = self.face_service.provider.info()
        if (
            provider.model_name != enrollment.model_name
            or provider.model_version != enrollment.model_version
            or provider.embedding_dimension != enrollment.embedding_dimension
        ):
            raise FaceServiceUnavailableError(
                "FACE_MODEL_CHANGED_DURING_ENROLLMENT",
                "O modelo facial mudou durante a sessao; inicie um novo cadastro",
            )
        return enrollment

    async def _pending_candidates(self, enrollment_id: str) -> list[FaceTemplate]:
        return list(
            await self.session.scalars(
                select(FaceTemplate)
                .where(
                    FaceTemplate.enrollment_session_id == enrollment_id,
                    FaceTemplate.active.is_(False),
                    FaceTemplate.deactivation_reason == PENDING_ENROLLMENT_REASON,
                )
                .order_by(FaceTemplate.collected_at.asc())
            )
        )

    @staticmethod
    def _automatic_quality_reasons(processed: ProcessedFace) -> list[str]:
        reasons = [reason.value for reason in processed.quality.reasons]
        pose = processed.inference.pose
        ignored: set[str] = set()
        if (
            "FACE_TOO_SMALL" in reasons
            and (processed.quality.metrics.face_area_ratio or 0.0)
            >= settings.FACE_ENROLLMENT_MIN_FACE_AREA_RATIO
        ):
            ignored.add("FACE_TOO_SMALL")
        if (
            "LOW_OVERALL_QUALITY" in reasons
            and processed.quality.quality_score >= settings.FACE_ENROLLMENT_MIN_QUALITY
        ):
            ignored.add("LOW_OVERALL_QUALITY")
        if pose is not None:
            if (
                "EXCESSIVE_YAW" in reasons
                and abs(pose.yaw) <= settings.FACE_ENROLLMENT_TURN_MAX_YAW
            ):
                ignored.add("EXCESSIVE_YAW")
            if (
                "EXCESSIVE_PITCH" in reasons
                and abs(pose.pitch) <= settings.FACE_ENROLLMENT_LOOK_UP_MAX_PITCH
            ):
                ignored.add("EXCESSIVE_PITCH")
        return [reason for reason in reasons if reason not in ignored]

    @staticmethod
    def _pose_bucket(processed: ProcessedFace) -> str:
        pose = processed.inference.pose
        if pose is None:
            return "NATURAL"
        if abs(pose.yaw) <= 11 and abs(pose.pitch) <= 11:
            return "FRONTAL"
        if pose.yaw < -11:
            return "LEFT"
        if pose.yaw > 11:
            return "RIGHT"
        if pose.pitch < -9:
            return "UP"
        if pose.pitch > 9:
            return "DOWN"
        return "NATURAL"

    @staticmethod
    def _pose_coverage(candidates: list[FaceTemplate]) -> list[str]:
        return sorted(
            {
                str((candidate.pose_json or {}).get("bucket") or "NATURAL")
                for candidate in candidates
            }
        )

    @staticmethod
    def _automatic_ready(candidates: list[FaceTemplate]) -> bool:
        if len(candidates) < settings.FACE_ENROLLMENT_MIN_IMAGES:
            return False
        poses = [candidate.pose_json or {} for candidate in candidates]
        yaw_values = [float(item.get("yaw") or 0.0) for item in poses]
        pitch_values = [float(item.get("pitch") or 0.0) for item in poses]
        coverage = FaceEnrollmentService._pose_coverage(candidates)
        has_natural_reference = any(
            abs(yaw) <= 18 and abs(pitch) <= 18
            for yaw, pitch in zip(yaw_values, pitch_values)
        )
        has_variation = (
            len(coverage) >= 2
            or (max(yaw_values) - min(yaw_values)) >= 8
            or (max(pitch_values) - min(pitch_values)) >= 6
        )
        return has_natural_reference and has_variation

    @staticmethod
    def _automatic_instruction(candidates: list[FaceTemplate], *, ready: bool) -> str:
        if ready:
            return "Amostras consistentes; finalizando o cadastro"
        if not candidates:
            return "Posicione o rosto naturalmente dentro da área da câmera"
        coverage = FaceEnrollmentService._pose_coverage(candidates)
        if "FRONTAL" not in coverage and "NATURAL" not in coverage:
            return "Olhe naturalmente para a câmera por um instante"
        if len(coverage) < 2:
            return "Mova o rosto levemente, sem sair da área indicada"
        return "Continue olhando para a câmera; o progresso será preservado"

    @staticmethod
    def _select_final_candidates(
        candidates: list[FaceTemplate],
        *,
        limit: int,
    ) -> list[FaceTemplate]:
        remaining = list(candidates)
        selected: list[FaceTemplate] = []
        natural = [
            item
            for item in remaining
            if abs(float((item.pose_json or {}).get("yaw") or 0.0)) <= 18
            and abs(float((item.pose_json or {}).get("pitch") or 0.0)) <= 18
        ]
        if natural:
            first = max(natural, key=lambda item: item.quality_score)
            selected.append(first)
            remaining.remove(first)

        while remaining and len(selected) < limit:
            selected_buckets = {
                str((item.pose_json or {}).get("bucket") or "NATURAL")
                for item in selected
            }

            def utility(item: FaceTemplate) -> float:
                pose = item.pose_json or {}
                bucket = str(pose.get("bucket") or "NATURAL")
                bucket_novelty = 1.0 if bucket not in selected_buckets else 0.0
                if not selected:
                    pose_novelty = 1.0
                else:
                    yaw = float(pose.get("yaw") or 0.0)
                    pitch = float(pose.get("pitch") or 0.0)
                    pose_novelty = min(
                        1.0,
                        max(
                            (
                                abs(yaw - float((chosen.pose_json or {}).get("yaw") or 0.0))
                                + abs(pitch - float((chosen.pose_json or {}).get("pitch") or 0.0))
                            ) / 36.0
                            for chosen in selected
                        ),
                    )
                return (
                    (float(item.quality_score) * 0.72)
                    + (bucket_novelty * 0.16)
                    + (pose_novelty * 0.12)
                )

            chosen = max(remaining, key=utility)
            selected.append(chosen)
            remaining.remove(chosen)
        return sorted(selected, key=lambda item: item.collected_at)

    @staticmethod
    def _automatic_summary(candidate: FaceTemplate) -> dict:
        metrics = candidate.quality_metrics or {}
        pose = candidate.pose_json or {}
        return {
            "sample_id": candidate.id,
            "quality_score": candidate.quality_score,
            "perceptual_hash": metrics.get("perceptual_hash"),
            "captured_at": candidate.collected_at.isoformat(),
            "pose_bucket": pose.get("bucket"),
            "yaw": pose.get("yaw"),
            "pitch": pose.get("pitch"),
            "roll": pose.get("roll"),
            "face_area_ratio": metrics.get("face_area_ratio"),
            "detection_confidence": metrics.get("detection_confidence"),
        }

    @staticmethod
    def _sample_response(
        enrollment: FaceEnrollmentSession,
        candidates: list[FaceTemplate],
        *,
        processed: ProcessedFace,
        accepted: bool,
        state: EnrollmentState,
        instruction: str,
        reasons: list[str],
        sample_id: str | None = None,
    ) -> EnrollmentSampleResponse:
        target = settings.FACE_ENROLLMENT_MIN_IMAGES
        ready = FaceEnrollmentService._automatic_ready(candidates)
        progress = 1.0 if ready else min(0.96, len(candidates) / max(target, 1))
        pose = processed.inference.pose
        metrics = processed.quality.metrics
        return EnrollmentSampleResponse(
            session_id=enrollment.id,
            accepted=accepted,
            state=state,
            instruction=instruction,
            reasons=reasons,
            accepted_samples=len(candidates),
            target_samples=target,
            ready=ready,
            progress=round(progress, 4),
            sample_id=sample_id,
            pose_bucket=FaceEnrollmentService._pose_bucket(processed),
            pose_coverage=FaceEnrollmentService._pose_coverage(candidates),
            quality_score=processed.quality.quality_score,
            face_area_ratio=metrics.face_area_ratio,
            blur_score=metrics.blur_variance,
            luminance_mean=metrics.luminance_mean,
            contrast_score=metrics.contrast_stddev,
            detection_confidence=processed.inference.detection_score,
            observed_yaw=pose.yaw if pose else None,
            observed_pitch=pose.pitch if pose else None,
            observed_roll=pose.roll if pose else None,
            processing_ms=processed.total_ms,
        )

    async def _validate_burst(
        self,
        payload: EnrollmentCaptureRequest,
    ) -> tuple[ValidatedCapture | None, EnrollmentCaptureResponse | None]:
        if len(payload.frames) < settings.FACE_ENROLLMENT_MIN_FRAMES_PER_POSE:
            raise FaceInputError(
                "INSUFFICIENT_ENROLLMENT_FRAMES",
                "A captura precisa de mais frames para validar estabilidade",
                minimum=settings.FACE_ENROLLMENT_MIN_FRAMES_PER_POSE,
            )
        timestamps = [_as_utc_naive(frame.captured_at) for frame in payload.frames]
        span_ms = (max(timestamps) - min(timestamps)).total_seconds() * 1000
        if span_ms < settings.FACE_ENROLLMENT_MIN_BURST_SPAN_MS:
            return None, self._rejection(
                payload,
                EnrollmentState.HOLD_STILL,
                "Mantenha a pose por mais tempo",
                ["BURST_TOO_SHORT"],
            )

        processed_frames = await asyncio.to_thread(
            lambda: [
                self.face_service.from_image_base64(frame.image_base64)
                for frame in payload.frames
            ]
        )
        if len({processed.image.sha256 for processed in processed_frames}) < 2:
            return None, self._rejection(
                payload,
                EnrollmentState.DUPLICATE_CAPTURE,
                "Os frames da rajada sao identicos",
                ["DUPLICATE_BURST_FRAMES"],
            )
        for processed in processed_frames:
            reasons = [reason.value for reason in processed.quality.reasons]
            effective_reasons = self._effective_quality_reasons(
                payload.pose,
                processed,
                reasons,
            )
            if effective_reasons or processed.inference.embedding is None:
                if processed.inference.embedding is None and not effective_reasons:
                    effective_reasons = ["EMBEDDING_UNAVAILABLE"]
                state, instruction = self._quality_instruction(effective_reasons)
                return None, self._rejection(
                    payload,
                    state,
                    instruction,
                    effective_reasons,
                    processed,
                )
            pose_reason = self._pose_rejection(payload.pose, processed)
            if pose_reason:
                state = self._state_for_pose(payload.pose)
                return None, self._rejection(
                    payload,
                    state,
                    self._instruction_for_pose(payload.pose, pose_reason),
                    [pose_reason],
                    processed,
                )
            if (processed.quality.metrics.face_area_ratio or 0.0) > 0.58:
                return None, self._rejection(
                    payload,
                    EnrollmentState.MOVE_AWAY,
                    "Afaste um pouco o rosto da camera",
                    ["FACE_TOO_CLOSE"],
                    processed,
                )

        vectors = [processed.inference.embedding or [] for processed in processed_frames]
        similarities = _pairwise_similarities(vectors)
        burst_median = float(median(similarities)) if similarities else 0.0
        if burst_median < settings.FACE_ENROLLMENT_MIN_BURST_SIMILARITY:
            return None, self._rejection(
                payload,
                EnrollmentState.HOLD_STILL,
                "Mantenha o rosto estavel durante a captura",
                ["UNSTABLE_BURST_IDENTITY"],
                processed_frames[0],
                burst_median,
            )

        selected_index, selected = max(
            enumerate(processed_frames),
            key=lambda item: item[1].quality.quality_score,
        )
        return (
            ValidatedCapture(
                request=payload,
                selected=selected,
                selected_captured_at=payload.frames[selected_index].captured_at,
                perceptual_hash=FaceImageValidator.perceptual_hash(selected.image.image_bgr),
                burst_similarity_median=round(burst_median, 4),
            ),
            None,
        )

    @staticmethod
    def _state_for_pose(pose: EnrollmentPose) -> EnrollmentState:
        return {
            EnrollmentPose.FRONTAL: EnrollmentState.LOOK_FORWARD,
            EnrollmentPose.FRONTAL_FINAL: EnrollmentState.LOOK_FORWARD,
            EnrollmentPose.TURN_LEFT: EnrollmentState.TURN_LEFT,
            EnrollmentPose.TURN_RIGHT: EnrollmentState.TURN_RIGHT,
            EnrollmentPose.LOOK_UP: EnrollmentState.LOOK_UP,
        }[pose]

    @staticmethod
    def _instruction_for_pose(
        pose: EnrollmentPose,
        reason: str | None = None,
    ) -> str:
        if reason == "TURN_TOO_FAR":
            return "Volte um pouco o rosto; o giro foi maior que o necessário"
        if reason == "LOOK_UP_TOO_FAR":
            return "Abaixe um pouco o rosto; a inclinação foi maior que o necessário"
        return {
            EnrollmentPose.FRONTAL: "Olhe de frente para a câmera",
            EnrollmentPose.FRONTAL_FINAL: "Volte a olhar de frente",
            EnrollmentPose.TURN_LEFT: "Vire levemente o rosto para a esquerda",
            EnrollmentPose.TURN_RIGHT: "Vire levemente o rosto para a direita",
            EnrollmentPose.LOOK_UP: "Incline levemente o rosto para cima",
        }[pose]

    @staticmethod
    def _quality_instruction(reasons: list[str]) -> tuple[EnrollmentState, str]:
        reason_set = set(reasons)
        if "NO_FACE" in reason_set:
            return EnrollmentState.WAITING_FACE, "Posicione o rosto na câmera"
        if "MULTIPLE_FACES" in reason_set:
            return EnrollmentState.WAITING_FACE, "Mantenha apenas uma pessoa diante da câmera"
        if "FACE_TOO_SMALL" in reason_set:
            return EnrollmentState.MOVE_CLOSER, "Aproxime um pouco o rosto"
        if "FACE_OUT_OF_FRAME" in reason_set:
            return EnrollmentState.ALIGN_FACE, "Mantenha o rosto inteiro dentro da imagem"
        if "FACE_OFF_CENTER" in reason_set:
            return EnrollmentState.ALIGN_FACE, "Mova o rosto um pouco para o centro"
        if reason_set & {"UNDEREXPOSED", "OVEREXPOSED", "LOW_CONTRAST"}:
            return EnrollmentState.IMPROVE_LIGHTING, "Ajuste a iluminação do rosto"
        if "IMAGE_TOO_BLURRY" in reason_set:
            return EnrollmentState.HOLD_STILL, "Mantenha o rosto parado"
        if reason_set & {"EXCESSIVE_YAW", "EXCESSIVE_PITCH", "EXCESSIVE_ROLL"}:
            return EnrollmentState.ALIGN_FACE, "Reduza um pouco o movimento do rosto"
        if "LANDMARKS_INSUFFICIENT" in reason_set:
            return EnrollmentState.ALIGN_FACE, "Deixe olhos, nariz e boca totalmente visíveis"
        return EnrollmentState.ALIGN_FACE, "Ajuste o rosto dentro da área indicada"

    @staticmethod
    def _effective_quality_reasons(
        expected: EnrollmentPose,
        processed: ProcessedFace,
        reasons: list[str],
    ) -> list[str]:
        pose = processed.inference.pose
        if pose is None:
            return reasons

        ignored: set[str] = set()
        if (
            "FACE_TOO_SMALL" in reasons
            and (processed.quality.metrics.face_area_ratio or 0.0)
            >= settings.FACE_ENROLLMENT_MIN_FACE_AREA_RATIO
        ):
            ignored.add("FACE_TOO_SMALL")
        if (
            "LOW_OVERALL_QUALITY" in reasons
            and processed.quality.quality_score
            >= settings.FACE_ENROLLMENT_MIN_QUALITY
        ):
            ignored.add("LOW_OVERALL_QUALITY")
        if expected == EnrollmentPose.TURN_LEFT and (
            -settings.FACE_ENROLLMENT_TURN_MAX_YAW
            <= pose.yaw
            <= -settings.FACE_ENROLLMENT_TURN_MIN_YAW
        ):
            ignored.add("EXCESSIVE_YAW")
        elif expected == EnrollmentPose.TURN_RIGHT and (
            settings.FACE_ENROLLMENT_TURN_MIN_YAW
            <= pose.yaw
            <= settings.FACE_ENROLLMENT_TURN_MAX_YAW
        ):
            ignored.add("EXCESSIVE_YAW")
        elif expected == EnrollmentPose.LOOK_UP and (
            -settings.FACE_ENROLLMENT_LOOK_UP_MAX_PITCH
            <= pose.pitch
            <= -settings.FACE_ENROLLMENT_LOOK_UP_MIN_PITCH
        ):
            ignored.add("EXCESSIVE_PITCH")

        return [reason for reason in reasons if reason not in ignored]

    @staticmethod
    def _pose_rejection(expected: EnrollmentPose, processed: ProcessedFace) -> str | None:
        pose = processed.inference.pose
        if pose is None:
            return "POSE_UNAVAILABLE"
        if expected in {EnrollmentPose.FRONTAL, EnrollmentPose.FRONTAL_FINAL}:
            if (
                abs(pose.yaw) > settings.FACE_ENROLLMENT_FRONTAL_MAX_YAW
                or abs(pose.pitch) > settings.FACE_ENROLLMENT_FRONTAL_MAX_PITCH
            ):
                return "LOOK_FORWARD_REQUIRED"
        elif expected == EnrollmentPose.TURN_LEFT:
            if pose.yaw > -settings.FACE_ENROLLMENT_TURN_MIN_YAW:
                return "TURN_LEFT_REQUIRED"
            if pose.yaw < -settings.FACE_ENROLLMENT_TURN_MAX_YAW:
                return "TURN_TOO_FAR"
        elif expected == EnrollmentPose.TURN_RIGHT:
            if pose.yaw < settings.FACE_ENROLLMENT_TURN_MIN_YAW:
                return "TURN_RIGHT_REQUIRED"
            if pose.yaw > settings.FACE_ENROLLMENT_TURN_MAX_YAW:
                return "TURN_TOO_FAR"
        elif expected == EnrollmentPose.LOOK_UP:
            if pose.pitch > -settings.FACE_ENROLLMENT_LOOK_UP_MIN_PITCH:
                return "LOOK_UP_REQUIRED"
            if pose.pitch < -settings.FACE_ENROLLMENT_LOOK_UP_MAX_PITCH:
                return "LOOK_UP_TOO_FAR"
        return None

    @staticmethod
    def _is_repeat_frontal_pair(
        left: EnrollmentPose,
        right: EnrollmentPose,
    ) -> bool:
        return {left, right} == {
            EnrollmentPose.FRONTAL,
            EnrollmentPose.FRONTAL_FINAL,
        }

    @staticmethod
    def _rejection(
        payload: EnrollmentCaptureRequest,
        state: EnrollmentState,
        instruction: str,
        reasons: list[str],
        processed: ProcessedFace | None = None,
        burst_similarity: float | None = None,
    ) -> EnrollmentCaptureResponse:
        pose = processed.inference.pose if processed else None
        return EnrollmentCaptureResponse(
            session_id="",
            accepted=False,
            state=state,
            step_index=payload.step_index,
            pose=payload.pose,
            instruction=instruction,
            reasons=reasons,
            quality_score=processed.quality.quality_score if processed else None,
            burst_similarity_median=(
                round(burst_similarity, 4) if burst_similarity is not None else None
            ),
            observed_yaw=pose.yaw if pose else None,
            observed_pitch=pose.pitch if pose else None,
            observed_roll=pose.roll if pose else None,
        )

    @staticmethod
    def _capture_summary(capture: ValidatedCapture) -> dict:
        pose = capture.selected.inference.pose
        return {
            "step_index": capture.request.step_index,
            "pose": capture.request.pose.value,
            "perceptual_hash": capture.perceptual_hash,
            "quality_score": capture.selected.quality.quality_score,
            "burst_similarity_median": capture.burst_similarity_median,
            "captured_at": capture.selected_captured_at.isoformat(),
            "frame_count": len(capture.request.frames),
            "yaw": pose.yaw if pose else None,
            "pitch": pose.pitch if pose else None,
            "roll": pose.roll if pose else None,
        }

    @staticmethod
    def _validate_model_compatibility(
        enrollment: FaceEnrollmentSession,
        captures: list[ValidatedCapture],
    ) -> None:
        incompatible = [
            capture.request.step_index
            for capture in captures
            if capture.selected.inference.model_name != enrollment.model_name
            or capture.selected.inference.model_version != enrollment.model_version
            or capture.selected.inference.embedding_dimension != enrollment.embedding_dimension
            or capture.selected.inference.detector_name != enrollment.detector_name
            or capture.selected.inference.normalization_version != enrollment.normalization_version
        ]
        if incompatible:
            raise FaceServiceUnavailableError(
                "INCOMPATIBLE_ENROLLMENT_MODEL",
                "Capturas processadas por modelo incompativel",
                steps=incompatible,
            )

    @staticmethod
    def _validate_temporal_diversity(captures: list[ValidatedCapture]) -> None:
        timestamps = [_as_utc_naive(capture.selected_captured_at) for capture in captures]
        duration = (max(timestamps) - min(timestamps)).total_seconds()
        if duration < settings.FACE_ENROLLMENT_MIN_SESSION_SPAN_SECONDS:
            raise FaceInputError(
                "ENROLLMENT_CAPTURED_TOO_QUICKLY",
                "As poses foram capturadas em um intervalo curto demais",
                minimum_seconds=settings.FACE_ENROLLMENT_MIN_SESSION_SPAN_SECONDS,
                observed_seconds=round(duration, 3),
            )

    @staticmethod
    def _validate_perceptual_diversity(captures: list[ValidatedCapture]) -> None:
        duplicates = []
        for left, right in combinations(captures, 2):
            if FaceEnrollmentService._is_repeat_frontal_pair(
                left.request.pose,
                right.request.pose,
            ):
                continue
            distance = FaceImageValidator.perceptual_distance(
                left.perceptual_hash,
                right.perceptual_hash,
            )
            if distance < settings.FACE_ENROLLMENT_MIN_PERCEPTUAL_DISTANCE:
                duplicates.append(
                    {
                        "left_step": left.request.step_index,
                        "right_step": right.request.step_index,
                        "distance": distance,
                    }
                )
        if duplicates:
            raise FaceInputError(
                "DUPLICATE_ENROLLMENT_CAPTURES",
                "O cadastro contem capturas perceptualmente repetidas",
                duplicates=duplicates,
            )

    @staticmethod
    def _consistency(captures: list[ValidatedCapture]) -> EnrollmentConsistencyResponse:
        vectors = [capture.selected.inference.embedding or [] for capture in captures]
        return FaceEnrollmentService._consistency_from_vectors(vectors)

    @staticmethod
    def _consistency_from_vectors(
        vectors: list[list[float] | np.ndarray],
    ) -> EnrollmentConsistencyResponse:
        pair_values = _pairwise_similarities(vectors)
        per_step_values: dict[int, list[float]] = {index: [] for index in range(len(vectors))}
        for (left_index, right_index), value in zip(combinations(range(len(vectors)), 2), pair_values):
            per_step_values[left_index].append(value)
            per_step_values[right_index].append(value)
        outliers = [
            step
            for step, values in per_step_values.items()
            if values and median(values) < settings.FACE_ENROLLMENT_MIN_PAIR_SIMILARITY
        ]
        return EnrollmentConsistencyResponse(
            pair_count=len(pair_values),
            minimum_similarity=round(min(pair_values), 4),
            median_similarity=round(float(median(pair_values)), 4),
            similarity_stddev=round(float(np.std(pair_values)), 4),
            outlier_steps=outliers,
        )
