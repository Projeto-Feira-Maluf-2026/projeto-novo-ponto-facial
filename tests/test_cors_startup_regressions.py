"""Production startup must tolerate, but never authorize, leftover local origins."""

import os
from pathlib import Path
import subprocess
import sys

import httpx
from pydantic import ValidationError
import pytest

from app.application import create_application
from app.core.config import Settings, settings


PUBLIC_ORIGIN = "https://curitiba-gestao.vercel.app"
LEGACY_ORIGINS = (
    "http://localhost:5174,http://localhost:8080,http://127.0.0.1:5174,"
    "http://[::1]:5174," + PUBLIC_ORIGIN
)


def production_config(**overrides):
    return Settings.model_validate({
        **settings.model_dump(),
        "ENVIRONMENT": "production",
        "FACE_PROVIDER": "insightface",
        "CORS_ORIGIN_REGEX": None,
        "FRONTEND_URL": PUBLIC_ORIGIN,
        "CORS_ORIGINS": LEGACY_ORIGINS,
        **overrides,
    })


@pytest.mark.parametrize("environment", ["production", "staging"])
def test_deployed_config_discards_only_http_loopback_origins(environment):
    config = production_config(ENVIRONMENT=environment)
    assert config.cors_origins == [PUBLIC_ORIGIN]
    assert config.CORS_ORIGINS == PUBLIC_ORIGIN
    assert config.REDIS_REQUIRED is True


def test_local_development_keeps_its_http_origins():
    config = production_config(ENVIRONMENT="development")
    assert "http://localhost:5174" in config.cors_origins
    assert "http://[::1]:5174" in config.cors_origins


@pytest.mark.parametrize("origin", [
    "http://example.com", "http://localhost.evil.example", "http://192.168.0.10",
    "http://user:password@localhost:5174", "http://localhost:5174/path",
    "http://localhost:5174?query=1", "http://localhost:5174#fragment", "*",
])
def test_local_origin_compatibility_does_not_bypass_other_cors_validation(origin):
    with pytest.raises(ValidationError, match="CORS"):
        production_config(CORS_ORIGINS=f"{origin},{PUBLIC_ORIGIN}")


def test_production_frontend_itself_still_requires_https():
    with pytest.raises(ValidationError, match="HTTPS"):
        production_config(FRONTEND_URL="http://localhost:5174")


@pytest.mark.asyncio
async def test_deployed_cors_allows_site_and_denies_local_and_unknown_origins(monkeypatch):
    config = production_config()
    monkeypatch.setattr("app.application.settings", config)
    app = create_application()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="https://testserver",
    ) as client:
        for origin in (PUBLIC_ORIGIN, "http://localhost:5174", "https://attacker.example"):
            response = await client.options("/api/v1/employees", headers={
                "Origin": origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization,content-type",
            })
            if origin == PUBLIC_ORIGIN:
                assert response.status_code == 200
                assert response.headers["access-control-allow-origin"] == origin
            else:
                assert response.status_code == 400
                assert "access-control-allow-origin" not in response.headers


def test_real_serverless_entrypoint_boots_without_native_face_imports():
    # A fresh interpreter exercises import-time Settings, unlike tests using an
    # already initialized settings singleton. No real env or services are used.
    env = {
        **os.environ,
        "PONTO_SKIP_DOTENV": "1",
        "ENVIRONMENT": "production",
        "VERCEL": "1",
        "FACE_RUNTIME_MODE": "lightweight",
        "FACE_PROVIDER": "insightface",
        "CORS_ORIGINS": LEGACY_ORIGINS,
        "CORS_ORIGIN_REGEX": "",
        "FRONTEND_URL": PUBLIC_ORIGIN,
    }
    script = '''
import asyncio
import importlib.abc
import sys
import httpx

class BlockNativeImports(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        # Pillow is shipped with reportlab and used for employee photos. Only
        # inference packages absent from root requirements are forbidden here.
        if fullname.split(".")[0] in {"numpy", "cv2", "insightface", "onnxruntime"}:
            raise ImportError("Native dependency forbidden in serverless startup")

sys.meta_path.insert(0, BlockNativeImports())
from api.index import app

async def smoke():
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://test") as client:
            live = await client.get("/api/health/live")
            assert live.status_code == 200
            assert live.json()["status"] == "alive"
            for path in ("/api/v1/dashboard", "/api/v1/employees", "/api/v1/worksites"):
                denied = await client.get(path)
                assert denied.status_code == 401
                assert denied.headers["content-type"].startswith("application/json")
    print("SERVERLESS_STARTUP_OK")

asyncio.run(smoke())
'''
    result = subprocess.run(
        [sys.executable, "-c", script], env=env,
        cwd=Path(__file__).resolve().parents[1],
        capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0, result.stderr
    assert "SERVERLESS_STARTUP_OK" in result.stdout
