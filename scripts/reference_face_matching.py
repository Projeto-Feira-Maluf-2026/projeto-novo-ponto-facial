"""Scalar protected matching reference for synthetic performance comparisons.

Uses the production normalization/quality gates and the original per-identity
centroid/median algorithm. Never invoked by an API request.
"""

from collections.abc import Mapping
from math import isfinite
from statistics import median
import numpy as np
from app.core.config import settings
from app.services.ai.facial_service import (
    TemplateCandidate,
    RankedFaceMatch,
    _normalize_embedding,
    _clamp_score,
    deserialize_embedding,
)


def rank_identity_candidates(
    query_embedding: list[float] | np.ndarray,
    candidates_by_employee: Mapping[str, list[TemplateCandidate]],
) -> list[RankedFaceMatch]:
    """Rank identities with a quality-weighted centroid and a robust per-template score.

    Templates are quality-gated and capped before scoring. This keeps an identity from
    gaining weight merely because it has more stored captures.
    """
    try:
        query = _normalize_embedding(query_embedding)
    except (TypeError, ValueError):
        return []

    ranked: list[RankedFaceMatch] = []
    maximum_templates = max(1, int(settings.FACE_IDENTITY_MAX_TEMPLATES))
    top_k = max(1, int(settings.FACE_IDENTITY_TOP_K))
    minimum_quality = float(settings.FACE_MATCH_MIN_TEMPLATE_QUALITY)

    for employee_id, candidates in candidates_by_employee.items():
        eligible = sorted(
            (
                candidate
                for candidate in candidates
                if isfinite(float(candidate.quality_score))
                and minimum_quality <= float(candidate.quality_score) <= 1.0
            ),
            key=lambda candidate: (
                -float(candidate.quality_score),
                candidate.template_id,
            ),
        )[:maximum_templates]
        rejected_count = len(candidates) - len(eligible)
        if not eligible:
            continue

        vectors: list[np.ndarray] = []
        qualities: list[float] = []
        individual_scores: list[float] = []
        for candidate in eligible:
            try:
                vector = deserialize_embedding(candidate.embedding)
            except (TypeError, ValueError):
                rejected_count += 1
                continue
            if vector.shape != query.shape:
                rejected_count += 1
                continue
            quality = _clamp_score(candidate.quality_score)
            vectors.append(vector)
            qualities.append(max(quality, 1e-6))
            similarity = float(np.dot(query, vector))
            individual_scores.append(
                _clamp_score(similarity) * (0.85 + (0.15 * quality))
            )

        if not vectors:
            continue
        centroid = np.average(np.stack(vectors), axis=0, weights=np.asarray(qualities))
        centroid /= max(float(np.linalg.norm(centroid)), 1e-9)
        centroid_score = _clamp_score(float(np.dot(query, centroid)))
        strongest = sorted(individual_scores, reverse=True)[:top_k]
        robust_score = _clamp_score(float(median(strongest)))
        aggregate_score = _clamp_score((centroid_score * 0.55) + (robust_score * 0.45))
        ranked.append(
            RankedFaceMatch(
                employee_id=employee_id,
                score=aggregate_score,
                best_score=_clamp_score(max(individual_scores)),
                template_count=len(vectors),
                centroid_score=centroid_score,
                robust_score=robust_score,
                rejected_template_count=rejected_count,
            )
        )
    return sorted(ranked, key=lambda item: item.score, reverse=True)
