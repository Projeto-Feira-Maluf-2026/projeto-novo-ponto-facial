import numpy as np

from app.services.ai.facial_service import (
    TemplateCandidate,
    face_match_confidence_score,
    is_face_match_ambiguous,
    rank_identity_candidates,
    serialize_embedding,
)


def candidate(template_id: str, vector: list[float], quality: float) -> TemplateCandidate:
    normalized = np.asarray(vector, dtype=np.float32)
    normalized /= np.linalg.norm(normalized)
    return TemplateCandidate(template_id, serialize_embedding(normalized.tolist()), quality)


def test_flags_lookalike_when_margin_is_too_close() -> None:
    assert is_face_match_ambiguous(0.75, 0.72) is True
    assert face_match_confidence_score(0.75, 0.72) < 0.9


def test_robust_identity_ranking_has_no_template_count_bonus() -> None:
    query = [1.0, 0.0, 0.0]
    single = rank_identity_candidates(
        query,
        {"alice": [candidate("a-1", query, 0.9)]},
    )[0]
    repeated = rank_identity_candidates(
        query,
        {
            "alice": [
                candidate(f"a-{index}", query, 0.9)
                for index in range(20)
            ]
        },
    )[0]

    assert repeated.template_count == 5
    assert repeated.rejected_template_count == 15
    assert repeated.score == single.score


def test_robust_identity_ranking_quality_gates_and_resists_outlier() -> None:
    query = [1.0, 0.0, 0.0]
    ranked = rank_identity_candidates(
        query,
        {
            "consistent": [
                candidate("c-1", [0.96, 0.20, 0.0], 0.95),
                candidate("c-2", [0.94, 0.24, 0.0], 0.92),
                candidate("c-3", [0.92, 0.28, 0.0], 0.90),
                candidate("c-outlier", [0.0, 1.0, 0.0], 0.60),
            ],
            "low-quality-perfect": [
                candidate("lq-1", query, 0.20),
            ],
        },
    )

    assert [match.employee_id for match in ranked] == ["consistent"]
    assert ranked[0].robust_score > 0.9
    assert ranked[0].centroid_score > 0.9
    assert ranked[0].rejected_template_count == 0
