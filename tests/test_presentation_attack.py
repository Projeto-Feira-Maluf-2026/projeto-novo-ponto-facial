import numpy as np
import pytest

from app.services.ai.presentation_attack import (
    PresentationAttackDecision,
    evaluate_presentation_attack,
)


def test_no_configured_pad_never_accepts() -> None:
    decision = evaluate_presentation_attack([np.zeros((8, 8, 3), dtype=np.uint8)])
    assert not decision.accepted and not decision.evaluated
    assert decision.reason == "pad_unavailable"


@pytest.mark.parametrize("score", [None, float("nan"), float("inf"), -0.1, 1.1])
def test_invalid_provider_evidence_never_accepts(score: float | None) -> None:
    class Adapter:
        def evaluate(self, images):
            return PresentationAttackDecision(True, True, score, "ok", "test-only")

    decision = evaluate_presentation_attack([np.zeros((8, 8, 3))], provider=Adapter())
    assert not decision.accepted and not decision.evaluated


def test_pad_provider_exception_is_closed() -> None:
    class Adapter:
        def evaluate(self, images):
            raise RuntimeError("private inference details")

    decision = evaluate_presentation_attack([np.zeros((8, 8, 3))], provider=Adapter())
    assert decision.reason == "pad_unavailable" and not decision.accepted


def test_pad_result_requires_version_and_evaluation() -> None:
    class Adapter:
        def evaluate(self, images):
            return PresentationAttackDecision(True, False, 1.0, "ok", "test-only")

    assert not evaluate_presentation_attack(
        [np.zeros((8, 8, 3))], provider=Adapter()
    ).accepted


def test_validated_internal_adapter_result_keeps_rejection() -> None:
    class Adapter:
        def evaluate(self, images):
            return PresentationAttackDecision(
                False, True, 0.1, "presentation_attack", "test-only"
            )

    decision = evaluate_presentation_attack([np.zeros((8, 8, 3))], provider=Adapter())
    assert decision.evaluated and not decision.accepted
