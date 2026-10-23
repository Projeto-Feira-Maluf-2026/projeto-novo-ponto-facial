from base64 import urlsafe_b64encode
from datetime import UTC, datetime, timedelta
import json

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
import httpx
import pytest

from app.core.config import settings
from app.core.errors import AppError
from app.models.enums import UserRole
from app.services.auth import AuthService


def encode_segment(payload: dict) -> str:
    return urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode("utf-8")
    ).rstrip(b"=").decode("ascii")


def signed_access_token() -> tuple[str, str]:
    private_key = ec.generate_private_key(ec.SECP256R1())
    public_numbers = private_key.public_key().public_numbers()
    key_id = "test-key"
    now = datetime.now(tz=UTC)
    header = encode_segment({"alg": "ES256", "typ": "JWT", "kid": key_id})
    payload = encode_segment(
        {
            "sub": "e1078324-745a-4f31-9397-813f7312aa47",
            "email": "admin@example.com",
            "iss": f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1",
            "aud": "authenticated",
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(minutes=10)).timestamp()),
            "app_metadata": {"role": "SUPER_ADMIN"},
            "user_metadata": {"name": "Administrador"},
        }
    )
    signed_data = f"{header}.{payload}".encode("ascii")
    der_signature = private_key.sign(signed_data, ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der_signature)
    signature = urlsafe_b64encode(
        r.to_bytes(32, "big") + s.to_bytes(32, "big")
    ).rstrip(b"=").decode("ascii")
    jwks = json.dumps(
        {
            "keys": [
                {
                    "kty": "EC",
                    "alg": "ES256",
                    "use": "sig",
                    "kid": key_id,
                    "crv": "P-256",
                    "x": urlsafe_b64encode(public_numbers.x.to_bytes(32, "big")).rstrip(b"=").decode("ascii"),
                    "y": urlsafe_b64encode(public_numbers.y.to_bytes(32, "big")).rstrip(b"=").decode("ascii"),
                }
            ]
        }
    )
    return f"{header}.{payload}.{signature}", jwks


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
    assert "employees:delete" in user.scopes


def test_only_super_admin_receives_permanent_employee_delete_scope() -> None:
    rh_user = AuthService._to_read_model(
        user_payload(app_metadata={"role": "RH"})
    )

    assert "employees:write" in rh_user.scopes
    assert "employees:delete" not in rh_user.scopes


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


@pytest.mark.asyncio
async def test_signed_session_is_validated_locally_without_supabase_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    AuthService._cache.clear()
    AuthService._jwks_keys.cache_clear()
    token, jwks = signed_access_token()
    monkeypatch.setattr(settings, "SUPABASE_JWKS_JSON", jwks)

    async def unexpected_request(*_args, **_kwargs):
        raise AssertionError("Supabase Auth nao deveria ser chamado")

    monkeypatch.setattr(httpx.AsyncClient, "get", unexpected_request)

    user = await AuthService().authenticate(token)

    assert user.email == "admin@example.com"
    assert user.role == UserRole.SUPER_ADMIN
