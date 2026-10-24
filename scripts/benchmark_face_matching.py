"""Compare local matching with Git HEAD using synthetic vectors only.

Run with the project's Python 3.12 environment from any working directory:
    api/.venv/Scripts/python.exe scripts/benchmark_face_matching.py

This measures matching, not image decoding, inference, database or PAD accuracy.
No biometric captures, models, database connections or external services are used.
Configuration is synthetic; local .env files are not loaded.
"""

from __future__ import annotations

import argparse
import json
import os
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
        "--baseline", default="ac4d79d", help="Git revision before gallery preparation"
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
    # The benchmark never needs live configuration, credentials or services.
    os.environ.update({
        "PONTO_SKIP_DOTENV": "1", "ENVIRONMENT": "test", "FACE_PROVIDER": "fake",
        "DATABASE_URL": "postgresql://postgres:test@db.example.supabase.co:5432/postgres",
        "SUPABASE_URL": "https://example.supabase.co",
        "SUPABASE_PUBLISHABLE_KEY": "sb_publishable_test",
        "PASSWORD_PEPPER": "benchmark-only-password-pepper-1234567890",
        "FIELD_ENCRYPTION_KEY": "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=",
        "EMAIL_NOTIFICATIONS_ENABLED": "false", "PONTO_LIMIT_REDIS_URL": "",
    })
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
        preparation_start = time.perf_counter()
        gallery = current.prepare_face_gallery(pools, len(query))
        preparation_ms = (time.perf_counter() - preparation_start) * 1000
        for name, module, candidates in [
            ("HEAD", baseline, pools), ("working_tree", current, pools),
            ("warm_gallery", current, gallery),
        ]:
            module.rank_identity_candidates(query, candidates)
            samples = []
            for _ in range(args.repeats):
                started = time.perf_counter()
                rankings[name] = module.rank_identity_candidates(query, candidates)
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
        if not same_order:
            # Fail instead of printing identifiers: the report stays aggregate-only.
            raise SystemExit("A ordem das identidades mudou entre HEAD e a arvore local")
        if rankings["working_tree"] != rankings["warm_gallery"]:
            raise SystemExit("A galeria preparada mudou os resultados")
        print(
            json.dumps(
                {
                    "employees": count,
                    "templates_each": 5,
                    "dimension": 512,
                    "seed": args.seed,
                    "repeats": args.repeats,
                    "median_ms": measurements,
                    "gallery_preparation_ms": round(preparation_ms, 3),
                    "same_identity_order": True,
                    "max_score_drift": drift,
                }
            )
        )


if __name__ == "__main__":
    main()
