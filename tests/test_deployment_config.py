import json
import tomllib
from pathlib import Path

import pytest

from app.api.v1.routes.employees import _face_enrollment_service
from app.core.errors import AppError
from app.core.runtime import is_lightweight_serverless


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_vercel_routes_every_api_path_to_the_python_entrypoint() -> None:
    config = json.loads((PROJECT_ROOT / "vercel.json").read_text(encoding="utf-8"))

    assert "cleanUrls" not in config
    assert config["rewrites"][0] == {
        "source": "/api/:path*",
        "destination": "/api/index.py",
    }
    assert config["rewrites"][1]["destination"] == "/index.html"
    assert "api/index.py" in config["functions"]


def test_vercel_blob_sdk_is_installed_in_the_lightweight_function() -> None:
    requirements = (PROJECT_ROOT / "requirements.txt").read_text(encoding="utf-8")

    assert "vercel>=0.7.0,<1.0.0" in requirements


def test_vercel_detects_only_the_explicit_python_entrypoint() -> None:
    assert (PROJECT_ROOT / "api" / "index.py").is_file()
    assert (PROJECT_ROOT / "api" / "app" / "application.py").is_file()
    assert not (PROJECT_ROOT / "api" / "app" / "main.py").exists()
    entrypoint = (PROJECT_ROOT / "api" / "index.py").read_text(encoding="utf-8")
    assert 'os.environ.setdefault("FACE_RUNTIME_MODE", "lightweight")' in entrypoint


def test_native_face_packages_are_only_installed_by_the_ai_extra() -> None:
    pyproject = tomllib.loads(
        (PROJECT_ROOT / "api" / "pyproject.toml").read_text(encoding="utf-8")
    )
    base_dependencies = pyproject["project"]["dependencies"]
    ai_dependencies = pyproject["project"]["optional-dependencies"]["ai"]

    for package in ("numpy", "pillow", "opencv-python-headless", "insightface", "onnxruntime"):
        assert not any(dependency.startswith(package) for dependency in base_dependencies)
        assert any(dependency.startswith(package) for dependency in ai_dependencies)


def test_container_and_windows_setup_use_supported_python() -> None:
    dockerfile = (PROJECT_ROOT / "api" / "Dockerfile").read_text(encoding="utf-8")
    setup_script = (PROJECT_ROOT / "scripts" / "setup.ps1").read_text(encoding="utf-8")

    assert dockerfile.startswith("FROM python:3.12-slim")
    assert "py -3.12 -m venv" in setup_script


def test_face_runtime_mode_has_explicit_overrides(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("FACE_RUNTIME_MODE", "full")
    assert is_lightweight_serverless() is False

    monkeypatch.delenv("VERCEL")
    monkeypatch.setenv("FACE_RUNTIME_MODE", "lightweight")
    assert is_lightweight_serverless() is True


def test_lightweight_enrollment_fails_before_importing_native_ai(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("FACE_RUNTIME_MODE", "auto")

    with pytest.raises(AppError) as captured:
        _face_enrollment_service(None)  # type: ignore[arg-type]

    assert captured.value.code == "FACE_RUNTIME_NOT_INSTALLED"
    assert captured.value.status_code == 503
    assert "VITE_FACE_API_URL" in captured.value.details["remediation"]


def test_lightweight_attendance_module_does_not_import_numpy_at_startup() -> None:
    source = (PROJECT_ROOT / "api" / "app" / "services" / "attendance.py").read_text(
        encoding="utf-8"
    )
    startup_section = source.split("class AttendanceService", 1)[0]

    assert "import numpy" not in startup_section
