"""Read-only offline matching evaluation of an explicitly authorized JSON dataset.

No model, camera, database, network or configuration mutation. Outputs aggregates
only; it does not fit thresholds, certify biometrics, evaluate PAD, or establish
that the dataset was legally authorized. See docs/biometric-evaluation-protocol.md.
"""

from __future__ import annotations

import argparse
import json
from math import isfinite, sqrt
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))

import numpy as np  # noqa: E402
from app.services.ai.facial_service import (  # noqa: E402
    TemplateCandidate,
    rank_identity_candidates,
)


def _rate(errors: int, total: int) -> dict:
    if not total:
        return {"errors": errors, "trials": total, "rate": None, "wilson95": None}
    rate = errors / total
    z = 1.959963984540054
    denominator = 1 + z * z / total
    center = (rate + z * z / (2 * total)) / denominator
    half = (
        z * sqrt(rate * (1 - rate) / total + z * z / (4 * total * total)) / denominator
    )
    return {
        "errors": errors,
        "trials": total,
        "rate": rate,
        "wilson95": [max(0.0, center - half), min(1.0, center + half)],
    }


def _vector(record: dict, dimension: int) -> np.ndarray:
    try:
        vector = np.asarray(record.get("embedding"), dtype=np.float32)
    except (TypeError, ValueError):
        raise ValueError(
            "Embedding structure must be a finite numeric vector"
        ) from None
    if vector.shape != (dimension,) or not np.isfinite(vector).all():
        raise ValueError(
            "All embeddings must have the configured dimension and finite values"
        )
    if float(np.linalg.norm(vector.astype(np.float64))) <= 1e-9:
        raise ValueError("Zero embeddings are not evidence")
    return vector


def evaluate_dataset(
    dataset: dict, thresholds: list[float], margin: float, dimension: int = 512
) -> dict:
    if not isinstance(dataset, dict):
        raise ValueError("Dataset must be a JSON object")
    if not thresholds or any(not isfinite(t) or not 0 <= t <= 1 for t in thresholds):
        raise ValueError("Thresholds must be finite values in [0,1]")
    if not isfinite(margin) or not 0 <= margin <= 1:
        raise ValueError("Margin must be finite and in [0,1]")
    if dimension != 512:
        raise ValueError("This protocol requires the deployment's 512-D embeddings")
    templates, queries = dataset.get("templates", []), dataset.get("queries", [])
    if (
        not isinstance(templates, list)
        or not isinstance(queries, list)
        or any(not isinstance(record, dict) for record in [*templates, *queries])
    ):
        raise ValueError("Templates and queries must be lists of sample objects")
    if not templates or not queries:
        raise ValueError("Enrollment and independent query samples are required")
    seen = set()
    gallery = {}
    for record in [*templates, *queries]:
        sample_id = record.get("sample_id")
        if not isinstance(sample_id, str) or not sample_id or sample_id in seen:
            raise ValueError(
                "Unique sample_id values are required across enrollment and query splits"
            )
        seen.add(sample_id)
    for record in templates:
        identity = record.get("identity_id")
        if not isinstance(identity, str) or not identity:
            raise ValueError("Each template requires a pseudonymous identity_id")
        quality = record.get("quality_score")
        if (
            not isinstance(quality, (float, int))
            or not isfinite(quality)
            or not 0 <= quality <= 1
        ):
            raise ValueError("Template quality_score must be finite and in [0,1]")
        gallery.setdefault(identity, []).append(
            TemplateCandidate(
                record["sample_id"],
                _vector(record, dimension).tobytes(),
                quality,
            )
        )
    rows = []
    for record in queries:
        expected = record.get("identity_id")
        if expected is not None and expected not in gallery:
            raise ValueError(
                "Known queries must identify an enrolled identity; unknown queries use null"
            )
        ranked = rank_identity_candidates(_vector(record, dimension), gallery)
        rows.append((expected, ranked))
    reports = []
    for threshold in sorted(set(thresholds)):
        false_matches = false_nonmatches = genuine = impostor = 0
        wrong_known = missed_known = accepted_unknown = known = unknown = 0
        for expected, ranked in rows:
            by_identity = {
                candidate.employee_id: candidate.score for candidate in ranked
            }
            # A missing quality-gated identity has no eligible score and is rejected.
            for identity in gallery:
                accepted = by_identity.get(identity, -1.0) >= threshold
                if expected == identity:
                    genuine += 1
                    false_nonmatches += int(not accepted)
                else:
                    impostor += 1
                    false_matches += int(accepted)
            top = ranked[0] if ranked else None
            second = ranked[1].score if len(ranked) > 1 else None
            accepted = bool(
                top
                and top.score >= threshold
                and (second is None or top.score - second >= margin)
            )
            if expected is None:
                unknown += 1
                accepted_unknown += int(accepted)
            else:
                known += 1
                wrong_known += int(accepted and top.employee_id != expected)
                missed_known += int(not accepted or top.employee_id != expected)
        reports.append(
            {
                "threshold": threshold,
                "margin": margin,
                "verification_fmr": _rate(false_matches, impostor),
                "verification_fnmr": _rate(false_nonmatches, genuine),
                "identification_unknown_false_positive": _rate(
                    accepted_unknown, unknown
                ),
                "identification_known_miss_or_wrong": _rate(missed_known, known),
                "identification_known_wrong_accept": _rate(wrong_known, known),
            }
        )
    return {
        "schema_version": 1,
        "embedding_dimension": dimension,
        "gallery_identities": len(gallery),
        "template_samples": len(templates),
        "query_samples": len(queries),
        "results": reports,
        "limitations": [
            "matching-only; not image quality, camera, PAD or end-to-end accuracy",
            "Wilson intervals assume independent trials; reused identities are correlated",
            "no threshold/configuration mutation; authorized representative evaluation required",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path)
    parser.add_argument(
        "--authorized-dataset",
        action="store_true",
        required=True,
        help="Operator confirms authorization for local processing",
    )
    parser.add_argument("--threshold", type=float, nargs="+", default=[0.62, 0.78])
    parser.add_argument("--margin", type=float, default=0.06)
    args = parser.parse_args()
    if args.dataset.stat().st_size > 64 * 1024 * 1024:
        parser.error("Dataset exceeds the 64 MiB offline protocol limit")
    try:
        result = evaluate_dataset(
            json.loads(args.dataset.read_text(encoding="utf-8")),
            args.threshold,
            args.margin,
        )
    except (ValueError, TypeError, KeyError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
