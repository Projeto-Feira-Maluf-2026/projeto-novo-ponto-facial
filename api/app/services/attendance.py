import asyncio
from datetime import UTC, datetime, timedelta
from statistics import median

from sqlalchemy import and_, desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.entities import (
    AttendanceRecord,
    Employee,
    FaceTemplate,
    SuspiciousAttempt,
    Worksite,
)
from app.models.enums import AlertSeverity, AttendanceStatus, FraudType, PunchType
from app.schemas.attendance import AttendanceDecision, AttendanceRead, PunchCreate
from app.services.geofencing import is_inside_geofence


PUNCH_SEQUENCE = [PunchType.ENTRY, PunchType.LUNCH_OUT, PunchType.LUNCH_IN, PunchType.EXIT]


def next_punch_type(previous: PunchType | None) -> PunchType:
    if previous is None:
        return PunchType.ENTRY
    try:
        return PUNCH_SEQUENCE[(PUNCH_SEQUENCE.index(previous) + 1) % len(PUNCH_SEQUENCE)]
    except ValueError:
        return PunchType.ENTRY


def attendance_confidence(match_confidence: float, quality_score: float) -> float:
    """Combine only signals actually measured by the current server pipeline."""
    match = max(0.0, min(1.0, float(match_confidence)))
    quality = max(0.0, min(1.0, float(quality_score)))
    return round((match * 0.75) + (quality * 0.25), 4)


class AttendanceService:
    def __init__(
        self,
        session: AsyncSession,
        face_embeddings=None,
    ) -> None:
        self.session = session
        self.face_embeddings = face_embeddings

    def _face_embeddings(self):
        if self.face_embeddings is None:
            from app.services.ai.facial_service import FaceEmbeddingService

            self.face_embeddings = FaceEmbeddingService()
        return self.face_embeddings

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
                if processed.quality.accepted and processed.inference.embedding is not None:
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
        employee, similarity, second_similarity, match_confidence, match_reason = await self._match_employee(
            vectors,
            payload.employee_id,
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

        location = payload.location
        inside, distance = is_inside_geofence(
            worksite.latitude,
            worksite.longitude,
            location.latitude if location else None,
            location.longitude if location else None,
            worksite.geofence_radius_meters,
        )
        if not inside:
            await self._flag_attempt(
                payload,
                FraudType.OUT_OF_GEOFENCE,
                distance or 0,
                ["out_of_geofence"],
                employee_id=employee.id,
            )
            await self.session.commit()
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
                reasons=["out_of_geofence"],
                temporal_evidence_count=len(vectors),
                temporal_similarity_median=(
                    round(temporal_similarity_median, 4)
                    if temporal_similarity_median is not None
                    else None
                ),
            )

        punch_type = payload.punch_type or await self._infer_next_punch(employee.id)
        confidence = attendance_confidence(match_confidence, quality_score)
        status = AttendanceStatus.ACCEPTED if confidence >= settings.SUSPICIOUS_SCORE_THRESHOLD else AttendanceStatus.MANUAL_REVIEW
        record = AttendanceRecord(
            employee_id=employee.id,
            worksite_id=worksite.id,
            device_id=payload.device_id,
            punch_type=punch_type,
            status=status,
            occurred_at=(payload.occurred_at or datetime.now(UTC)).replace(tzinfo=None),
            latitude=location.latitude if location else None,
            longitude=location.longitude if location else None,
            similarity_score=similarity,
            liveness_score=None,
            quality_score=quality_score,
            confidence_score=confidence,
            offline_batch_id=payload.offline_batch_id,
            metadata_json={
                "geofence_distance_meters": distance,
                "second_best_similarity_score": second_similarity,
                "match_margin": margin,
                "match_confidence_score": match_confidence,
                "liveness_evaluated": False,
                "temporal_evidence_count": len(vectors),
                "temporal_similarity_median": temporal_similarity_median,
            },
        )
        self.session.add(record)
        await self.session.commit()
        await self.session.refresh(record)
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
            record=AttendanceRead.model_validate(record),
        )

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
            conditions.append(AttendanceRecord.occurred_at >= starts_at.replace(tzinfo=None))
        if ends_at:
            conditions.append(AttendanceRecord.occurred_at <= ends_at.replace(tzinfo=None))
        if conditions:
            statement = statement.where(and_(*conditions))
        result = await self.session.scalars(statement.order_by(desc(AttendanceRecord.occurred_at)).limit(500))
        return list(result)

    async def _infer_next_punch(self, employee_id: str) -> PunchType:
        since = datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=18)
        previous = await self.session.scalar(
            select(AttendanceRecord)
            .where(AttendanceRecord.employee_id == employee_id, AttendanceRecord.occurred_at >= since)
            .order_by(desc(AttendanceRecord.occurred_at))
            .limit(1)
        )
        return next_punch_type(previous.punch_type if previous else None)

    async def _match_employee(
        self,
        vectors: list[tuple[list[float], float]],
        employee_id: str | None,
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
                severity=AlertSeverity.HIGH if fraud_type != FraudType.OUT_OF_GEOFENCE else AlertSeverity.MEDIUM,
                confidence_score=float(confidence),
                details={"reasons": reasons, "offline_batch_id": payload.offline_batch_id},
            )
        )
