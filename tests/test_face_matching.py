import numpy as np
import pytest
from math import fsum, sqrt
from statistics import median

from app.services.ai.facial_service import (
    TemplateCandidate,
    cosine_similarity,
    face_match_confidence_score,
    is_face_match_ambiguous,
    rank_identity_candidates,
    serialize_embedding,
)


def candidate(
    template_id: str, vector: list[float], quality: float
) -> TemplateCandidate:
    normalized = np.asarray(vector, dtype=np.float32)
    normalized /= np.linalg.norm(normalized)
    return TemplateCandidate(
        template_id, serialize_embedding(normalized.tolist()), quality
    )


def test_vectorized_matching_across_batch_boundary_matches_scalar_reference() -> None:
    rng = np.random.default_rng(20261010)
    query = rng.normal(size=32).astype(np.float32)
    query /= np.linalg.norm(query)
    pools = {}
    expected = {}
    for employee in range(259):
        raw = rng.normal(size=(employee % 5 + 1, 32)).astype(np.float32)
        vectors = raw / np.linalg.norm(raw.astype(np.float64), axis=1)[:, None]
        qualities = np.linspace(0.7, 0.99, len(vectors))
        pools[str(employee)] = [
            TemplateCandidate(str(i), raw[i].tobytes(), float(qualities[i]))
            for i in range(len(raw))
        ]
        centroid = [
            fsum(
                float(vector[dim]) * float(quality)
                for vector, quality in zip(vectors, qualities)
            )
            / fsum(qualities)
            for dim in range(32)
        ]
        norm = sqrt(fsum(value * value for value in centroid))
        center_score = max(
            0.0, fsum(float(q) * value / norm for q, value in zip(query, centroid))
        )
        scores = sorted(
            [
                max(
                    0.0,
                    fsum(float(q) * float(value) for q, value in zip(query, vector)),
                )
                * (0.85 + 0.15 * quality)
                for vector, quality in zip(vectors, qualities)
            ],
            reverse=True,
        )
        expected[str(employee)] = center_score * 0.55 + median(scores[:3]) * 0.45
    ranked = rank_identity_candidates(query, pools)
    assert len(ranked) == 259
    for item in ranked:
        assert item.score == pytest.approx(expected[item.employee_id], abs=1e-7)
        assert item.rejected_template_count == 0
    assert [item.employee_id for item in ranked] == sorted(
        expected, key=expected.get, reverse=True
    )


def test_finite_large_vectors_normalize_without_overflow() -> None:
    vector = np.full(512, np.finfo(np.float32).max, dtype=np.float32)
    ranked = rank_identity_candidates(
        np.ones(512), {"large": [TemplateCandidate("large", vector.tobytes(), 0.9)]}
    )
    assert ranked[0].centroid_score == pytest.approx(1.0, abs=1e-7)
    assert ranked[0].score > 0.99


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
        {"alice": [candidate(f"a-{index}", query, 0.9) for index in range(20)]},
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


@pytest.mark.parametrize(
    "vector", [[float("nan"), 0.0], [float("inf"), 0.0], [0.0, 0.0], [], [[1.0, 0.0]]]
)
def test_invalid_query_cannot_produce_a_match(vector) -> None:
    assert (
        rank_identity_candidates(vector, {"alice": [candidate("a", [1.0, 0.0], 0.9)]})
        == []
    )
    assert cosine_similarity(vector, [1.0, 0.0]) == 0.0


@pytest.mark.parametrize(
    "blob",
    [
        b"bad",
        b"",
        serialize_embedding([float("nan"), 0.0]),
        serialize_embedding([float("inf"), 0.0]),
        serialize_embedding([0.0, 0.0]),
    ],
)
def test_corrupt_template_is_excluded_without_poisoning_valid_identity(
    blob: bytes,
) -> None:
    ranked = rank_identity_candidates(
        [1.0, 0.0],
        {
            "corrupt": [TemplateCandidate("bad", blob, 0.95)],
            "alice": [
                TemplateCandidate("bad", blob, 0.95),
                candidate("good", [1.0, 0.0], 0.9),
            ],
        },
    )
    assert [item.employee_id for item in ranked] == ["alice"]
    assert ranked[0].template_count == 1
    assert ranked[0].rejected_template_count == 1
    assert cosine_similarity([1.0, 0.0], blob) == 0.0


@pytest.mark.parametrize("quality", [float("nan"), float("inf"), 1.1, -0.1])
def test_invalid_template_quality_cannot_produce_a_match(quality: float) -> None:
    assert (
        rank_identity_candidates(
            [1.0, 0.0], {"alice": [candidate("a", [1.0, 0.0], quality)]}
        )
        == []
    )
