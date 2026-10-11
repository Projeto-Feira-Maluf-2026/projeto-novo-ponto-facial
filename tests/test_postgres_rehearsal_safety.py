import importlib.util
from pathlib import Path

import pytest

MODULE_PATH = Path(__file__).parents[1] / "scripts" / "verify_postgres_restore.py"
spec = importlib.util.spec_from_file_location("verify_postgres_restore", MODULE_PATH)
rehearsal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rehearsal)


@pytest.mark.parametrize("url", [
    "postgresql://postgres:fake@production.example/postgres",
    "postgresql://postgres:fake@127.0.0.1/application",
    "postgresql://postgres:fake@127.0.0.1/postgres?host=production.example",
    "http://localhost/postgres",
])
def test_rehearsal_rejects_production_and_nonisolated_inputs(url):
    with pytest.raises(ValueError):
        rehearsal.local_connection_environment(url)


def test_rehearsal_passes_credentials_only_via_child_environment():
    environment = rehearsal.local_connection_environment(
        "postgresql://postgres:fake%20password@127.0.0.1:15432/postgres"
    )
    assert environment["PGHOST"] == "127.0.0.1"
    assert environment["PGPORT"] == "15432"
    assert environment["PGPASSWORD"] == "fake password"
