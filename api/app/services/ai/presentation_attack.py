"""Server-side PAD boundary; temporal client scores never establish live presence.

The provider is MiniFASNet (``minifasnet_pad.py``) when its model files are
present and verified; otherwise it reports unavailable, which closes attendance
in staging/production. It operates only on server-decoded images.
"""

from dataclasses import dataclass
from math import isfinite
from typing import Protocol, Sequence

import numpy as np


@dataclass(frozen=True)
class PresentationAttackDecision:
    accepted: bool
    evaluated: bool
    score: float | None
    reason: str
    model_version: str | None = None


class PresentationAttackProvider(Protocol):
    def evaluate(self, images: Sequence[np.ndarray]) -> PresentationAttackDecision: ...


class UnavailablePresentationAttackProvider:
    def evaluate(self, images: Sequence[np.ndarray]) -> PresentationAttackDecision:
        return PresentationAttackDecision(False, False, None, "pad_unavailable")


def get_presentation_attack_provider() -> PresentationAttackProvider:
    # Deliberately no mock or permissive environment fallback in this factory:
    # the real MiniFASNet adapter, or a provider that reports unavailable.
    from app.services.ai.minifasnet_pad import get_minifasnet_provider

    return get_minifasnet_provider() or UnavailablePresentationAttackProvider()


def evaluate_presentation_attack(
    images: Sequence[np.ndarray],
    *,
    provider: PresentationAttackProvider | None = None,
) -> PresentationAttackDecision:
    """Normalize missing, malformed and failed provider results to closed decisions.

    Only internal server code may inject an adapter. Never deserialize a provider
    decision from the request body or equate this with replay-challenge validation.
    """
    if not images:
        return PresentationAttackDecision(False, False, None, "pad_no_frames")
    try:
        decision = (provider or get_presentation_attack_provider()).evaluate(images)
        if (
            not isinstance(decision, PresentationAttackDecision)
            or not decision.evaluated
            or decision.score is None
            or not isfinite(decision.score)
            or not 0.0 <= decision.score <= 1.0
            or not decision.model_version
        ):
            return PresentationAttackDecision(False, False, None, "pad_unavailable")
        return decision
    except Exception:
        # Avoid exposing model internals or image data in API errors/logs.
        return PresentationAttackDecision(False, False, None, "pad_unavailable")
