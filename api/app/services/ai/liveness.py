from dataclasses import dataclass, field

from app.core.config import settings
from app.models.enums import FraudType


@dataclass(frozen=True)
class LivenessInput:
    face_count: int
    liveness_score: float | None
    quality_score: float | None
    motion_score: float | None
    spoof_hints: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class LivenessDecision:
    accepted: bool
    score: float
    reasons: list[str]
    fraud_type: FraudType | None = None
    evaluated: bool = True


class LivenessEvaluator:
    def evaluate(self, payload: LivenessInput) -> LivenessDecision:
        reasons: list[str] = []
        score_parts: list[float] = []

        if payload.face_count > settings.FACE_MAX_FACES:
            return LivenessDecision(
                accepted=False,
                score=0.0,
                reasons=["multiple_faces"],
                fraud_type=FraudType.MULTIPLE_FACES,
            )
        if payload.face_count == 0:
            return LivenessDecision(
                accepted=False,
                score=0.0,
                reasons=["no_face"],
                fraud_type=FraudType.UNKNOWN_FACE,
            )

        if payload.liveness_score is None or payload.motion_score is None:
            return LivenessDecision(
                accepted=False,
                score=0.0,
                reasons=["liveness_not_evaluated"],
                evaluated=False,
            )

        liveness = payload.liveness_score
        quality = payload.quality_score if payload.quality_score is not None else 0.0
        motion = payload.motion_score
        score_parts.extend([liveness * 0.45, quality * 0.30, motion * 0.25])
        score = sum(score_parts)

        hints = {hint.lower() for hint in payload.spoof_hints}
        fraud_type = None
        if "printed_photo" in hints:
            fraud_type = FraudType.PRINTED_PHOTO
            reasons.append("printed_photo")
            score -= 0.35
        if "phone_screen" in hints:
            fraud_type = FraudType.PHONE_SCREEN
            reasons.append("phone_screen")
            score -= 0.35
        if "video_replay" in hints:
            fraud_type = FraudType.VIDEO_REPLAY
            reasons.append("video_replay")
            score -= 0.35

        if liveness < settings.FACE_MIN_LIVENESS:
            reasons.append("low_liveness")
            fraud_type = fraud_type or FraudType.LOW_LIVENESS
        if quality < settings.FACE_MIN_QUALITY:
            reasons.append("low_quality")
        if motion < 0.35:
            reasons.append("low_motion")

        score = max(0.0, min(1.0, score))
        accepted = score >= settings.FACE_MIN_LIVENESS and not reasons
        return LivenessDecision(accepted=accepted, score=score, reasons=reasons, fraud_type=fraud_type)
