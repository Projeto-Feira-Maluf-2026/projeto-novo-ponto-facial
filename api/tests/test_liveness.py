from app.models.enums import FraudType
from app.services.ai.liveness import LivenessEvaluator, LivenessInput


def test_accepts_good_liveness() -> None:
    decision = LivenessEvaluator().evaluate(
        LivenessInput(face_count=1, liveness_score=0.92, quality_score=0.86, motion_score=0.74)
    )
    assert decision.accepted is True
    assert decision.score > 0.8


def test_rejects_multiple_faces() -> None:
    decision = LivenessEvaluator().evaluate(
        LivenessInput(face_count=2, liveness_score=0.92, quality_score=0.86, motion_score=0.74)
    )
    assert decision.accepted is False
    assert decision.fraud_type == FraudType.MULTIPLE_FACES


def test_rejects_phone_screen_hint() -> None:
    decision = LivenessEvaluator().evaluate(
        LivenessInput(
            face_count=1,
            liveness_score=0.91,
            quality_score=0.88,
            motion_score=0.78,
            spoof_hints=["phone_screen"],
        )
    )
    assert decision.accepted is False
    assert decision.fraud_type == FraudType.PHONE_SCREEN


def test_missing_liveness_is_reported_as_not_evaluated() -> None:
    decision = LivenessEvaluator().evaluate(
        LivenessInput(
            face_count=1,
            liveness_score=None,
            quality_score=0.82,
            motion_score=None,
        )
    )

    assert decision.accepted is False
    assert decision.evaluated is False
    assert decision.reasons == ["liveness_not_evaluated"]
    assert "low_liveness" not in decision.reasons
