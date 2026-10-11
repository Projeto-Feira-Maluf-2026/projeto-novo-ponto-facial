import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi import Depends, FastAPI, HTTPException
import httpx
import pytest

from app.api.deps import get_current_user, require_scopes
from app.core.config import settings
from app.core.config import Settings
from app.core.permissions import Scope
from app.core import rate_limit
from app.db.session import get_session
from app.models.enums import UserRole
from app.schemas.devices import DeviceHeartbeat
from app.services.devices import DeviceService


@pytest.fixture(autouse=True)
def isolated_counters(monkeypatch):
    rate_limit._fallback.clear()
    monkeypatch.setattr(settings, "ENVIRONMENT", "test")
    yield
    rate_limit._fallback.clear()


def redis_stub(monkeypatch, **kwargs):
    client = SimpleNamespace(eval=AsyncMock(**kwargs))
    monkeypatch.setattr(rate_limit, "redis_client", lambda *args: client)
    return client


@pytest.mark.asyncio
async def test_quota_uses_one_atomic_redis_call_and_returns_retry_after(monkeypatch):
    monkeypatch.setattr(settings, "RATE_LIMIT_REPORTS_PER_MINUTE", 2)
    client = redis_stub(monkeypatch, side_effect=[1, 2, 3])
    await rate_limit.check_rate_limit("user:known-user", "reports")
    await rate_limit.check_rate_limit("user:known-user", "reports")
    with pytest.raises(HTTPException) as error:
        await rate_limit.check_rate_limit("user:known-user", "reports")
    assert error.value.status_code == 429
    assert 1 <= int(error.value.headers["Retry-After"]) <= 60
    script, numkeys, key, ttl = client.eval.await_args.args
    assert script == rate_limit.ATOMIC_INCREMENT
    assert numkeys == 1 and ttl == 120
    assert "known-user" not in key


@pytest.mark.asyncio
@pytest.mark.parametrize("environment", ["production", "staging"])
async def test_deployed_environment_fails_closed_on_redis_outage(monkeypatch, environment):
    monkeypatch.setattr(settings, "ENVIRONMENT", environment)
    redis_stub(monkeypatch, side_effect=ConnectionError("private-redis-endpoint"))
    with pytest.raises(HTTPException) as error:
        await rate_limit.check_rate_limit("user:a", "attendance")
    assert error.value.status_code == 503
    assert "private-redis-endpoint" not in error.value.detail
    assert not rate_limit._fallback


@pytest.mark.asyncio
async def test_redis_deadline_cancels_slow_call(monkeypatch):
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "RATE_LIMIT_REDIS_TIMEOUT_SECONDS", .05)
    cancelled = asyncio.Event()
    async def slow_call(*args):
        try:
            await asyncio.sleep(10)
        finally:
            cancelled.set()
    redis_stub(monkeypatch, side_effect=slow_call)
    with pytest.raises(HTTPException) as error:
        await rate_limit.check_rate_limit("user:a", "attendance")
    assert error.value.status_code == 503
    assert cancelled.is_set()


@pytest.mark.asyncio
async def test_development_fallback_still_throttles_and_is_bounded(monkeypatch):
    monkeypatch.setattr(settings, "RATE_LIMIT_MUTATIONS_PER_MINUTE", 2)
    monkeypatch.setattr(settings, "RATE_LIMIT_FALLBACK_MAX_KEYS", 16)
    redis_stub(monkeypatch, side_effect=ConnectionError())
    await rate_limit.check_rate_limit("user:a", "mutation")
    await rate_limit.check_rate_limit("user:a", "mutation")
    with pytest.raises(HTTPException) as error:
        await rate_limit.check_rate_limit("user:a", "mutation")
    assert error.value.status_code == 429
    for index in range(15):
        await rate_limit.check_rate_limit(f"user:{index}", "mutation")
    assert len(rate_limit._fallback) == 16
    with pytest.raises(HTTPException) as full:
        await rate_limit.check_rate_limit("user:new", "mutation")
    assert full.value.status_code == 503
    # Capacity pressure must not evict the active principal and reset its quota.
    with pytest.raises(HTTPException) as still_throttled:
        await rate_limit.check_rate_limit("user:a", "mutation")
    assert still_throttled.value.status_code == 429


def test_rate_limit_keys_have_fixed_bound_and_buckets_ignore_resource_ids():
    key = rate_limit.rate_limit_key("secret" * 10000, "attendance", 12345)
    assert len(key) < 150 and "secret" not in key
    assert rate_limit.bucket_for_request("PATCH", "/api/v1/attendance/private-id") == "attendance"
    assert rate_limit.bucket_for_request("POST", "/api/v1/ai/identify-face") == "ai"
    assert rate_limit.bucket_for_request("POST", "/api/v1/reports/export") == "reports"
    assert rate_limit.bucket_for_request("POST", "/api/v1/employees/private-id/photo") == "mutation"
    assert rate_limit.bucket_for_request("GET", "/api/v1/attendance/history") is None


@pytest.mark.parametrize("environment", ["staging", "production"])
def test_deployed_config_requires_redis_even_if_explicitly_disabled(environment):
    config = Settings.model_validate({
        **settings.model_dump(), "ENVIRONMENT": environment,
        "FACE_PROVIDER": "insightface", "REDIS_REQUIRED": False,
        "CORS_ORIGINS": "https://example.com", "CORS_ORIGIN_REGEX": None,
    })
    assert config.REDIS_REQUIRED is True


@pytest.mark.asyncio
async def test_dependency_throttles_before_mutation_runs(monkeypatch):
    redis_stub(monkeypatch, return_value=601)
    app = FastAPI()
    calls = []
    async def current_user():
        return SimpleNamespace(id="a", role=UserRole.SUPER_ADMIN)
    async def session():
        yield SimpleNamespace()
    app.dependency_overrides[get_current_user] = current_user
    app.dependency_overrides[get_session] = session
    @app.post("/api/v1/attendance/punch")
    async def mutation(_=Depends(require_scopes(Scope.ATTENDANCE_WRITE))):
        calls.append("called")
        return {"accepted": True}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/v1/attendance/punch")
    assert response.status_code == 429
    assert not calls


@pytest.mark.asyncio
async def test_device_heartbeat_throttles_after_valid_auth_before_commit(monkeypatch):
    device = SimpleNamespace(id="d", api_key_hash="synthetic", last_seen_at=None, metadata_json=None)
    session = SimpleNamespace(scalar=AsyncMock(return_value=device), commit=AsyncMock())
    limiter = AsyncMock(side_effect=HTTPException(429, "limited"))
    monkeypatch.setattr("app.services.devices.verify_password", lambda *args: True)
    monkeypatch.setattr("app.services.devices.check_rate_limit", limiter)
    with pytest.raises(HTTPException):
        await DeviceService(session).heartbeat(DeviceHeartbeat(serial_number="test", api_key="test"))
    limiter.assert_awaited_once_with("device:d", "heartbeat")
    session.commit.assert_not_awaited()
    assert device.last_seen_at is None


@pytest.mark.asyncio
async def test_facial_analysis_requires_authentication_before_inference():
    from app.application import create_application
    app = create_application()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/v1/ai/analyze-face", json={"image_base64": "not-real-image-at-all"})
    assert response.status_code == 401
