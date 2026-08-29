import asyncio
import logging
from datetime import UTC, datetime, time
from statistics import median
from uuid import uuid4

from sqlalchemy import and_, desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.time import as_local, as_utc_naive, local_day_utc_bounds
from app.models.entities import (
    AttendanceRecord,
    Employee,
    EmployeeWorksite,
    FaceTemplate,
    SuspiciousAttempt,
    Worksite,
)
from app.models.enums import AlertSeverity, AttendanceStatus, FraudType, PunchType
from app.schemas.attendance import (
    AttendanceCorrection,
    AttendanceDecision,
    AttendanceRead,
    PunchCreate,
)
from app.services.audit import audit

logger = logging.getLogger(__name__)

PUNCH_SEQUENCE = [PunchType.ENTRY, PunchType.LUNCH_OUT, PunchType.LUNCH_IN, PunchType.EXIT]

# Em uma leitura de ponto, a identidade ainda e confirmada pelo embedding,
# pelo limiar de similaridade e pela margem para o segundo melhor candidato.
# Blur moderado e a pose estimada a partir de poucos pixels sao sinais muito
# instaveis em rostos distantes e nao devem, sozinhos, impedir essa comparacao.
ATTENDANCE_RECOVERABLE_QUALITY_REASONS = {
    "IMAGE_TOO_BLURRY",
    "EXCESSIVE_YAW",
    "EXCESSIVE_PITCH",
    "EXCESSIVE_ROLL",
}


EVENING_EXIT_START = time(16, 0)


def next_punch_type(
    previous: PunchType | None,
    occurred_at: datetime | None = None,
) -> PunchType:
    if previous is None:
        return PunchType.ENTRY
    # Sem uma escala individual cadastrada, uma segunda batida no fim do dia
    # deve ser saida, nunca uma improvavel saida para almoco as 22h.
    if (
        previous == PunchType.ENTRY
        and occurred_at is not None
        and as_local(occurred_at).time() >= EVENING_EXIT_START
    ):
        return PunchType.EXIT
    try:
        return PUNCH_SEQUENCE[(PUNCH_SEQUENCE.index(previous) + 1) % len(PUNCH_SEQUENCE)]
    except ValueError:
        return PunchType.ENTRY


def attendance_confidence(match_confidence: float, quality_score: float) -> float:
    """Combine only signals actually measured by the current server pipeline."""
    match = max(0.0, min(1.0, float(match_confidence)))
    quality = max(0.0, min(1.0, float(quality_score)))
    return round((match * 0.75) + (quality * 0.25), 4)


def attendance_frame_is_usable(processed) -> bool:
    """Accept a detected embedding when only distance-sensitive checks failed."""
    if processed.inference.embedding is None:
        return False
    if processed.quality.accepted:
        return True
    reasons = {
        getattr(reason, "value", str(reason))
        for reason in processed.quality.reasons
    }
    return bool(reasons) and reasons.issubset(ATTENDANCE_RECOVERABLE_QUALITY_REASONS)


class AttendanceService:
    def __init__(
        self,
        session: AsyncSession,
        face_embeddings=None,
        email_notifier=None,
        actor_user_id: str | None = None,
    ) -> None:
        self.session = session
        self.face_embeddings = face_embeddings
        self.email_notifier = email_notifier
        self.actor_user_id = actor_user_id

    def _face_embeddings(self):
        if self.face_embeddings is None:
            from app.services.ai.facial_service import FaceEmbeddingService

            self.face_embeddings = FaceEmbeddingService()
        return self.face_embeddings

    def _email_notifier(self):
        if self.email_notifier is None:
            from app.services.email_notifications import AttendanceEmailNotifier

            self.email_notifier = AttendanceEmailNotifier()
        return self.email_notifier

    async def register_punch(self, payload: PunchCreate) -> AttendanceDecision:
        from app.services.ai.facial_service import face_match_margin

        worksite = await self.session.get(Worksite, payload.worksite_id)
        if not worksite or not worksite.active:
            raise LookupError("Obra nao encontrada ou inativa")

        quality_score = max(0.0, float(payload.face.quality_score or 0.0))
        vectors: list[tuple[list[float], float]] = []
        temporal_similarity_median: float | None = None
        submitted_images = list(dict.fromkeys([
            *payload.face.images_base64,
            *([payload.face.image_base64] if payload.face.image_base64 else []),
        ]))
        rejected_frame_reasons: list[str] = []
        if submitted_images:
            processed_frames = await asyncio.to_thread(
                lambda: [
                    self._face_embeddings().from_image_base64(image)
                    for image in submitted_images
                ]
            )
            for processed in processed_frames:
                if attendance_frame_is_usable(processed):
                    vectors.append(
                        (processed.inference.embedding, processed.quality.quality_score)
                    )
                else:
                    rejected_frame_reasons.extend(
                        reason.value for reason in processed.quality.reasons
                    )
            required_frames = (
                settings.FACE_TEMPORAL_MIN_FRAMES
                if payload.face.images_base64
                else 1
            )
            if len(vectors) < required_frames:
                reasons = list(dict.fromkeys([
                    "INSUFFICIENT_TEMPORAL_EVIDENCE",
                    *rejected_frame_reasons,
                ]))
                await self._flag_attempt(payload, FraudType.UNKNOWN_FACE, 1.0, reasons)
                await self.session.commit()
                return AttendanceDecision(
                    accepted=False,
                    status=AttendanceStatus.REJECTED,
                    employee_id=payload.employee_id,
                    punch_type=None,
                    confidence_score=0.0,
                    similarity_score=None,
                    liveness_score=None,
                    quality_score=max(
                        [quality_score, *[item[1] for item in vectors]],
                        default=quality_score,
                    ),
                    reasons=reasons,
                    temporal_evidence_count=len(vectors),
                )
        elif payload.face.embedding is not None:
            vectors.append((payload.face.embedding, quality_score))

        if not vectors:
            await self._flag_attempt(payload, FraudType.UNKNOWN_FACE, 1.0, ["missing_embedding"])
            await self.session.commit()
            return AttendanceDecision(
                accepted=False,
                status=AttendanceStatus.REJECTED,
                employee_id=payload.employee_id,
                punch_type=None,
                confidence_score=0.0,
                similarity_score=None,
                liveness_score=None,
                quality_score=quality_score,
                reasons=["missing_embedding"],
            )

        if len(vectors) > 1:
            from app.services.ai.facial_service import cosine_similarity

            temporal_scores = [
                cosine_similarity(left[0], right[0])
                for index, left in enumerate(vectors)
                for right in vectors[index + 1:]
            ]
            temporal_similarity_median = float(median(temporal_scores))
            if temporal_similarity_median < settings.FACE_TEMPORAL_MIN_EMBEDDING_SIMILARITY:
                reasons = ["TEMPORAL_IDENTITY_INCONSISTENT"]
                await self._flag_attempt(payload, FraudType.UNKNOWN_FACE, 1.0, reasons)
                await self.session.commit()
                return AttendanceDecision(
                    accepted=False,
                    status=AttendanceStatus.REJECTED,
                    employee_id=None,
                    punch_type=None,
                    confidence_score=0.0,
                    similarity_score=None,
                    liveness_score=None,
                    quality_score=max(item[1] for item in vectors),
                    reasons=reasons,
                    temporal_evidence_count=len(vectors),
                    temporal_similarity_median=round(temporal_similarity_median, 4),
                )

        quality_score = max([quality_score, *[candidate_quality for _, candidate_quality in vectors]])
        occurred_at = as_utc_naive(payload.occurred_at or datetime.now(UTC))
        employee, similarity, second_similarity, match_confidence, match_reason = await self._match_employee(
            vectors,
            payload.employee_id,
            payload.worksite_id,
            occurred_at,
        )
        margin = face_match_margin(similarity, second_similarity)

        if match_reason:
            fraud_type = FraudType.UNKNOWN_FACE if match_reason == "employee_mismatch" else FraudType.LOW_SIMILARITY
            await self._flag_attempt(payload, fraud_type, similarity or 0.0, [match_reason])
            await self.session.commit()
            return AttendanceDecision(
                accepted=False,
                status=AttendanceStatus.REJECTED,
                employee_id=None,
                punch_type=None,
                confidence_score=match_confidence,
                similarity_score=similarity,
                second_best_similarity_score=second_similarity,
                match_margin=margin,
                match_confidence_score=match_confidence,
                liveness_score=None,
                quality_score=quality_score,
                reasons=[match_reason],
                temporal_evidence_count=len(vectors),
                temporal_similarity_median=(
                    round(temporal_similarity_median, 4)
                    if temporal_similarity_median is not None
                    else None
                ),
            )

        if employee.status.value != "ACTIVE":
            return AttendanceDecision(
                accepted=False,
                status=AttendanceStatus.REJECTED,
                employee_id=employee.id,
                employee_name=employee.name,
                employee_registration=employee.registration,
                employee_photo_url=employee.photo_url,
                punch_type=None,
                confidence_score=0.0,
                similarity_score=similarity,
                second_best_similarity_score=second_similarity,
                match_margin=margin,
                match_confidence_score=match_confidence,
                liveness_score=None,
                quality_score=quality_score,
                reasons=["inactive_employee"],
                temporal_evidence_count=len(vectors),
                temporal_similarity_median=(
                    round(temporal_similarity_median, 4)
                    if temporal_similarity_median is not None
                    else None
                ),
            )

        punch_type = payload.punch_type or await self._infer_next_punch(
            employee.id,
            occurred_at,
        )
        confidence = attendance_confidence(match_confidence, quality_score)
        status = AttendanceStatus.ACCEPTED if confidence >= settings.SUSPICIOUS_SCORE_THRESHOLD else AttendanceStatus.MANUAL_REVIEW
        record = AttendanceRecord(
            id=str(uuid4()),
            employee_id=employee.id,
            worksite_id=worksite.id,
            device_id=payload.device_id,
            punch_type=punch_type,
            status=status,
            occurred_at=occurred_at,
            latitude=None,
            longitude=None,
            similarity_score=similarity,
            liveness_score=None,
            quality_score=quality_score,
            confidence_score=confidence,
            offline_batch_id=payload.offline_batch_id,
            metadata_json={
                "second_best_similarity_score": second_similarity,
                "match_margin": margin,
                "match_confidence_score": match_confidence,
                "liveness_evaluated": False,
                "temporal_evidence_count": len(vectors),
                "temporal_similarity_median": temporal_similarity_median,
            },
        )
        self.session.add(record)
        if self.actor_user_id:
            await audit(
                self.session,
                "attendance.punch",
                actor_user_id=self.actor_user_id,
                entity="attendance_record",
                entity_id=record.id,
                metadata={
                    "employee_id": employee.id,
                    "worksite_id": worksite.id,
                    "punch_type": punch_type.value,
                    "status": status.value,
                    "offline_batch_id": payload.offline_batch_id,
                },
            )
        await self.session.commit()
        await self.session.refresh(record)
        email_notification_sent = False
        if status == AttendanceStatus.ACCEPTED and getattr(employee, "email", None):
            try:
                email_notification_sent = await self._email_notifier().send_confirmation(
                    recipient=employee.email,
                    employee_name=employee.name,
                    worksite_name=worksite.name,
                    punch_type=punch_type,
                    occurred_at=record.occurred_at,
                    record_id=record.id,
                )
            except Exception as exc:
                logger.warning(
                    "Falha inesperada na notificacao record_id=%s error_type=%s",
                    record.id,
                    type(exc).__name__,
                )
        return AttendanceDecision(
            accepted=status == AttendanceStatus.ACCEPTED,
            status=status,
            employee_id=employee.id,
            employee_name=employee.name,
            employee_registration=employee.registration,
            employee_photo_url=employee.photo_url,
            punch_type=punch_type,
            confidence_score=confidence,
            similarity_score=similarity,
            second_best_similarity_score=second_similarity,
            match_margin=margin,
            match_confidence_score=match_confidence,
            liveness_score=None,
            quality_score=quality_score,
            reasons=[] if status == AttendanceStatus.ACCEPTED else ["manual_review"],
            temporal_evidence_count=len(vectors),
            temporal_similarity_median=(
                round(temporal_similarity_median, 4)
                if temporal_similarity_median is not None
                else None
            ),
            email_notification_sent=email_notification_sent,
            record=AttendanceRead.model_validate(record),
        )

    async def correct(
        self,
        record_id: str,
        payload: AttendanceCorrection,
    ) -> AttendanceRecord:
        record = await self.session.get(AttendanceRecord, record_id)
        if not record:
            raise LookupError("Registro de ponto nao encontrado")
        if payload.status in {AttendanceStatus.REJECTED, AttendanceStatus.OFFLINE_PENDING}:
            raise ValueError("Correcao permite apenas ACCEPTED ou MANUAL_REVIEW")

        before = {
            "occurred_at": record.occurred_at.isoformat(),
            "punch_type": record.punch_type.value,
            "status": record.status.value,
            "notes": record.notes,
        }
        if payload.occurred_at is not None:
            record.occurred_at = as_utc_naive(payload.occurred_at)
        if payload.punch_type is not None:
            record.punch_type = payload.punch_type
        if payload.status is not None:
            record.status = payload.status
        record.notes = payload.reason
        after = {
            "occurred_at": record.occurred_at.isoformat(),
            "punch_type": record.punch_type.value,
            "status": record.status.value,
            "notes": record.notes,
        }
        await audit(
            self.session,
            "attendance.correct",
            actor_user_id=self.actor_user_id,
            entity="attendance_record",
            entity_id=record.id,
            metadata={"before": before, "after": after, "reason": payload.reason},
        )
        await self.session.commit()
        await self.session.refresh(record)
        return record

    async def history(
        self,
        employee_id: str | None,
        worksite_id: str | None,
        starts_at: datetime | None,
        ends_at: datetime | None,
    ) -> list[AttendanceRecord]:
        statement = select(AttendanceRecord)
        conditions = []
        if employee_id:
            conditions.append(AttendanceRecord.employee_id == employee_id)
        if worksite_id:
            conditions.append(AttendanceRecord.worksite_id == worksite_id)
        if starts_at:
            conditions.append(AttendanceRecord.occurred_at >= as_utc_naive(starts_at))
        if ends_at:
            conditions.append(AttendanceRecord.occurred_at <= as_utc_naive(ends_at))
        if conditions:
            statement = statement.where(and_(*conditions))
        result = await self.session.scalars(statement.order_by(desc(AttendanceRecord.occurred_at)).limit(500))
        return list(result)

    async def _infer_next_punch(
        self,
        employee_id: str,
        occurred_at: datetime,
    ) -> PunchType:
        local_day = as_local(occurred_at).date()
        day_start, day_end = local_day_utc_bounds(local_day)
        previous = await self.session.scalar(
            select(AttendanceRecord)
            .where(
                AttendanceRecord.employee_id == employee_id,
                AttendanceRecord.occurred_at >= day_start,
                AttendanceRecord.occurred_at < day_end,
                AttendanceRecord.occurred_at <= occurred_at,
            )
            .order_by(desc(AttendanceRecord.occurred_at))
            .limit(1)
        )
        return next_punch_type(previous.punch_type if previous else None, occurred_at)

    async def _match_employee(
        self,
        vectors: list[tuple[list[float], float]],
        employee_id: str | None,
        worksite_id: str | None = None,
        occurred_at: datetime | None = None,
    ) -> tuple[Employee | None, float, float | None, float, str | None]:
        import numpy as np

        from app.services.ai.facial_service import (
            TemplateCandidate,
            face_match_confidence_score,
            is_face_match_ambiguous,
            rank_identity_candidates,
        )

        provider_info = self._face_embeddings().provider.info()
        statement = select(FaceTemplate).where(
            FaceTemplate.active.is_(True),
            FaceTemplate.model_name == provider_info.model_name,
            FaceTemplate.model_version == provider_info.model_version,
            FaceTemplate.embedding_dimension == provider_info.embedding_dimension,
            FaceTemplate.detector_name == provider_info.detector_name,
            FaceTemplate.normalization_version == provider_info.normalization_version,
        )
        if employee_id:
            statement = statement.where(FaceTemplate.employee_id == employee_id)
        elif worksite_id:
            reference_time = occurred_at or datetime.now(UTC).replace(tzinfo=None)
            statement = statement.join(
                EmployeeWorksite,
                EmployeeWorksite.employee_id == FaceTemplate.employee_id,
            ).where(
                EmployeeWorksite.worksite_id == worksite_id,
                EmployeeWorksite.active.is_(True),
                or_(
                    EmployeeWorksite.starts_at.is_(None),
                    EmployeeWorksite.starts_at <= reference_time,
                ),
                or_(
                    EmployeeWorksite.ends_at.is_(None),
                    EmployeeWorksite.ends_at >= reference_time,
                ),
            )
        templates = list(await self.session.scalars(statement))
        if not templates:
            return None, 0.0, None, 0.0, "no_compatible_templates"
        expected_blob_size = int(provider_info.embedding_dimension or 0) * 4
        candidates_by_employee: dict[str, list[TemplateCandidate]] = {}
        for template in templates:
            if len(template.embedding) != expected_blob_size:
                continue
            candidates_by_employee.setdefault(template.employee_id, []).append(
                TemplateCandidate(
                    template_id=template.id,
                    embedding=template.embedding,
                    quality_score=template.quality_score,
                )
            )

        query_vectors = np.asarray([candidate[0] for candidate in vectors], dtype=np.float32)
        query_weights = np.asarray(
            [max(float(candidate[1]), 0.05) for candidate in vectors],
            dtype=np.float32,
        )
        query_vector = np.average(query_vectors, axis=0, weights=query_weights)
        query_vector /= max(float(np.linalg.norm(query_vector)), 1e-9)
        ranked = rank_identity_candidates(query_vector, candidates_by_employee)
        if not ranked:
            return None, 0.0, None, 0.0, "low_similarity"

        best_match = ranked[0]
        second_best_score = (
            ranked[1].score if not employee_id and len(ranked) > 1 else None
        )
        confidence_score = face_match_confidence_score(best_match.score, second_best_score)
        employee = await self.session.get(Employee, best_match.employee_id)
        if not employee:
            return None, best_match.score, second_best_score, confidence_score, "low_similarity"
        if best_match.score < settings.FACE_MIN_SIMILARITY:
            return employee, best_match.score, second_best_score, confidence_score, "low_similarity"
        if not employee_id and is_face_match_ambiguous(best_match.score, second_best_score):
            return employee, best_match.score, second_best_score, confidence_score, "ambiguous_face"
        return employee, best_match.score, second_best_score, confidence_score, None

    async def _flag_attempt(
        self,
        payload: PunchCreate,
        fraud_type: FraudType,
        confidence: float,
        reasons: list[str],
        employee_id: str | None = None,
    ) -> None:
        self.session.add(
            SuspiciousAttempt(
                employee_id=employee_id or payload.employee_id,
                worksite_id=payload.worksite_id,
                device_id=payload.device_id,
                fraud_type=fraud_type,
                severity=AlertSeverity.HIGH,
                confidence_score=float(confidence),
                details={"reasons": reasons, "offline_batch_id": payload.offline_batch_id},
            )
        )
