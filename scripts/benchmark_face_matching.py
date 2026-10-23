"""Compare local matching with Git HEAD using synthetic vectors only.

Run with the project's Python 3.12 environment from any working directory:
    api/.venv-audit/Scripts/python.exe scripts/benchmark_face_matching.py

This measures matching, not image decoding, inference, database or PAD accuracy.
No biometric captures, models, database connections or external services are used.
Normal application configuration is required for module imports.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import statistics
import subprocess
import sys
import time
import types


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--employees", type=int, nargs="+", default=[100, 1000])
    parser.add_argument("--repeats", type=int, default=7)
    parser.add_argument("--seed", type=int, default=20261010)
    parser.add_argument(
        "--baseline", default="824178f", help="Git revision before this audit"
    )
    parser.add_argument(
        "--baseline-file",
        type=Path,
        help="Local source snapshot for same-process comparison",
    )
    args = parser.parse_args()
    if args.repeats < 1 or any(count < 1 or count > 10000 for count in args.employees):
        parser.error("repeats must be positive; employees must be between 1 and 10000")

    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root / "api"))
    import numpy as np
    from app.services.ai import facial_service as current

    source = (
        args.baseline_file.read_text(encoding="utf-8")
        if args.baseline_file
        else subprocess.check_output(
            ["git", "show", f"{args.baseline}:api/app/services/ai/facial_service.py"],
            cwd=root,
            text=True,
            encoding="utf-8",
        )
    )
    baseline = types.ModuleType("face_matching_git_head_baseline")
    sys.modules[baseline.__name__] = baseline
    exec(compile(source, "<git HEAD facial_service>", "exec"), baseline.__dict__)

    rng = np.random.default_rng(args.seed)
    query = rng.normal(size=512).astype(np.float32)
    query /= np.linalg.norm(query)
    for count in args.employees:
        pools = {}
        for employee in range(count):
            vectors = rng.normal(size=(5, 512)).astype(np.float32)
            vectors /= np.linalg.norm(vectors, axis=1, keepdims=True)
            pools[str(employee)] = [
                current.TemplateCandidate(str(index), vector.tobytes(), 0.9)
                for index, vector in enumerate(vectors)
            ]

        measurements = {}
        rankings = {}
        for name, module in [("HEAD", baseline), ("working_tree", current)]:
            module.rank_identity_candidates(query, pools)
            samples = []
            for _ in range(args.repeats):
                started = time.perf_counter()
                rankings[name] = module.rank_identity_candidates(query, pools)
                samples.append((time.perf_counter() - started) * 1000)
            measurements[name] = round(statistics.median(samples), 3)

        same_order = [item.employee_id for item in rankings["HEAD"]] == [
            item.employee_id for item in rankings["working_tree"]
        ]
        drift = max(
            (
                abs(before.score - after.score)
                for before, after in zip(
                    rankings["HEAD"], rankings["working_tree"], strict=True
                )
            ),
            default=0.0,
        )
        print(
            json.dumps(
                {
                    "employees": count,
                    "templates_each": 5,
                    "dimension": 512,
                    "seed": args.seed,
                    "repeats": args.repeats,
                    "median_ms": measurements,
                    "same_identity_order": same_order,
                    "max_score_drift": drift,
                }
            )
        )


if __name__ == "__main__":
    main()
