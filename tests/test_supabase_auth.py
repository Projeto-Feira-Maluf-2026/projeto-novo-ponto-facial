import httpx
import pytest

from app.core.errors import AppError
from app.models.enums import UserRole
from app.services.auth import AuthService


def user_payload(**overrides) -> dict:
    payload = {
        "id": "e1078324-745a-4f31-9397-813f7312aa47",
        "email": "admin@example.com",
        "created_at": "2026-08-07T12:00:00Z",
        "app_metadata": {"role": "SUPER_ADMIN"},
        "user_metadata": {"name": "Administrador"},
    }
    payload.update(overrides)
    return payload


def test_authenticated_user_receives_full_access() -> None:
    user = AuthService._to_read_model(user_payload())

    assert user.role == UserRole.SUPER_ADMIN
    assert user.name == "Administrador"
    assert "audit:read" in user.scopes


def test_user_without_role_metadata_receives_minimum_access() -> None:
    payload = user_payload(
        app_metadata={},
        user_metadata={"name": "Usuario"},
    )

    user = AuthService._to_read_model(payload)

    assert user.role == UserRole.FUNCIONARIO
    assert "attendance:write" in user.scopes
    assert "audit:read" not in user.scopes
    assert "employees:write" not in user.scopes


def test_invalid_role_metadata_does_not_grant_admin_access() -> None:
    user = AuthService._to_read_model(
        user_payload(app_metadata={"role": "OWNER"})
    )

    assert user.role == UserRole.FUNCIONARIO
    assert "audit:read" not in user.scopes


@pytest.mark.asyncio
async def test_auth_provider_timeout_is_retryable_instead_of_internal_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    AuthService._cache.clear()

    async def timeout(*_args, **_kwargs):
        raise httpx.ReadTimeout("supabase timeout")

    monkeypatch.setattr(httpx.AsyncClient, "get", timeout)

    with pytest.raises(AppError) as captured:
        await AuthService().authenticate("new-token")

    assert captured.value.code == "AUTH_PROVIDER_UNAVAILABLE"
    assert captured.value.status_code == 503
    assert captured.value.details == {"retryable": True}


@pytest.mark.asyncio
async def test_recently_validated_session_avoids_repeated_supabase_requests(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    AuthService._cache.clear()
    calls = 0

    async def user_response(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        return httpx.Response(200, json=user_payload())

    monkeypatch.setattr(httpx.AsyncClient, "get", user_response)

    first = await AuthService().authenticate("cached-token")
    second = await AuthService().authenticate("cached-token")

    assert first == second
    assert calls == 1
