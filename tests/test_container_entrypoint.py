import importlib.util
from pathlib import Path

MODULE_PATH = Path(__file__).parents[1] / "api" / "container_entrypoint.py"
spec = importlib.util.spec_from_file_location("container_entrypoint", MODULE_PATH)
entrypoint = importlib.util.module_from_spec(spec)
spec.loader.exec_module(entrypoint)


def test_default_container_port_is_unprivileged(monkeypatch):
    monkeypatch.delenv("PORT", raising=False)
    assert entrypoint._port() == 8000


def test_platform_port_preserved(monkeypatch):
    monkeypatch.setenv("PORT", "12345")
    assert entrypoint._port() == 12345


def test_invalid_container_port_fails_safe(monkeypatch):
    monkeypatch.setenv("PORT", "not-a-port")
    assert entrypoint._port() == 8000
