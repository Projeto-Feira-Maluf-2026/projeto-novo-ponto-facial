from collections import OrderedDict
from base64 import urlsafe_b64decode
from datetime import UTC, datetime
import json
from hashlib import sha256
from functools import lru_cache
from time import monotonic
from time import time

import httpx
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

from app.core.config import settings
from app.core.errors import AppError
from app.core.permissions import scopes_for_role
from app.models.enums import UserRole
from app.schemas.auth import UserRead


class _LocalJwtUnavailable(Exception):
    """A validacao local nao esta configurada para este token."""


def _decode_segment(value: str) -> bytes:
    padding_size = (-len(value)) % 4
    try:
        return urlsafe_b64decode(value + ("=" * padding_size))
    except (ValueError, TypeError) as exc:
        raise PermissionError("Sessao invalida ou expirada") from exc


def _decode_integer(value: str) -> int:
    return int.from_bytes(_decode_segment(value), "big")


class AuthService:
    _cache: OrderedDict[str, tuple[float, UserRead]] = OrderedDict()
    _cache_ttl_seconds = 60.0
    _stale_grace_seconds = 300.0
    _cache_limit = 512

    async def authenticate(self, access_token: str) -> UserRead:
        cache_key = sha256(access_token.encode("utf-8")).hexdigest()
        cached = self._cached_user(cache_key, max_age=self._cache_ttl_seconds)
        if cached is not None:
            return cached

        try:
            local_user = self._authenticate_locally(access_token)
        except _LocalJwtUnavailable:
            pass
        else:
            self._store_cached_user(cache_key, local_user)
            return local_user

        headers = {
            "apikey": settings.SUPABASE_PUBLISHABLE_KEY,
            "Authorization": f"Bearer {access_token}",
            "User-Agent": "ponto-facial-api/1.0",
        }
        timeout_seconds = max(settings.AUTH_TIMEOUT_SECONDS, 1.0)
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(timeout_seconds, connect=min(timeout_seconds, 2.5)),
            ) as client:
                response = await client.get(
                    f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/user",
                    headers=headers,
                )
        except httpx.TransportError as exc:
            stale = self._cached_user(cache_key, max_age=self._stale_grace_seconds)
            if stale is not None:
                return stale
            raise AppError(
                "AUTH_PROVIDER_UNAVAILABLE",
                "Nao foi possivel validar a sessao agora. Tente novamente em instantes.",
                503,
                {"retryable": True},
            ) from exc
        if response.status_code != 200:
            self._cache.pop(cache_key, None)
            raise PermissionError("Sessao invalida ou expirada")

        user = self._to_read_model(response.json())
        self._store_cached_user(cache_key, user)
        return user

    @classmethod
    def _authenticate_locally(cls, access_token: str) -> UserRead:
        raw_jwks = settings.SUPABASE_JWKS_JSON
        if not raw_jwks:
            raise _LocalJwtUnavailable

        parts = access_token.split(".")
        if len(parts) != 3:
            raise PermissionError("Sessao invalida ou expirada")

        try:
            header = json.loads(_decode_segment(parts[0]))
            payload = json.loads(_decode_segment(parts[1]))
        except (json.JSONDecodeError, UnicodeDecodeError, TypeError) as exc:
            raise PermissionError("Sessao invalida ou expirada") from exc
        if not isinstance(header, dict) or not isinstance(payload, dict):
            raise PermissionError("Sessao invalida ou expirada")

        algorithm = header.get("alg")
        key_id = header.get("kid")
        jwk = next(
            (
                candidate
                for candidate in cls._jwks_keys(raw_jwks)
                if candidate.get("kid") == key_id and candidate.get("alg") == algorithm
            ),
            None,
        )
        if jwk is None:
            raise _LocalJwtUnavailable

        signed_data = f"{parts[0]}.{parts[1]}".encode("ascii")
        signature = _decode_segment(parts[2])
        try:
            if algorithm == "ES256" and jwk.get("kty") == "EC":
                if len(signature) != 64:
                    raise PermissionError("Sessao invalida ou expirada")
                public_key = ec.EllipticCurvePublicNumbers(
                    _decode_integer(jwk["x"]),
                    _decode_integer(jwk["y"]),
                    ec.SECP256R1(),
                ).public_key()
                der_signature = encode_dss_signature(
                    int.from_bytes(signature[:32], "big"),
                    int.from_bytes(signature[32:], "big"),
                )
                public_key.verify(der_signature, signed_data, ec.ECDSA(hashes.SHA256()))
            elif algorithm == "RS256" and jwk.get("kty") == "RSA":
                public_key = rsa.RSAPublicNumbers(
                    _decode_integer(jwk["e"]),
                    _decode_integer(jwk["n"]),
                ).public_key()
                public_key.verify(signature, signed_data, padding.PKCS1v15(), hashes.SHA256())
            else:
                raise _LocalJwtUnavailable
        except (InvalidSignature, ValueError, KeyError) as exc:
            raise PermissionError("Sessao invalida ou expirada") from exc

        cls._validate_claims(payload)
        issued_at = payload.get("iat")
        created_at = payload.get("created_at")
        if not created_at and isinstance(issued_at, (int, float)):
            created_at = datetime.fromtimestamp(issued_at, tz=UTC).isoformat()

        return cls._to_read_model(
            {
                **payload,
                "id": payload.get("sub"),
                "created_at": created_at or datetime.now(tz=UTC).isoformat(),
            }
        )

    @staticmethod
    @lru_cache(maxsize=4)
    def _jwks_keys(raw_jwks: str) -> tuple[dict, ...]:
        try:
            payload = json.loads(raw_jwks)
            keys = payload.get("keys", [])
        except (json.JSONDecodeError, AttributeError) as exc:
            raise _LocalJwtUnavailable from exc
        if not isinstance(keys, list):
            raise _LocalJwtUnavailable
        return tuple(key for key in keys if isinstance(key, dict))

    @staticmethod
    def _validate_claims(payload: dict) -> None:
        now = time()
        leeway_seconds = 30
        expires_at = payload.get("exp")
        not_before = payload.get("nbf")
        issuer = payload.get("iss")
        audience = payload.get("aud")
        expected_issuer = f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1"

        if not isinstance(expires_at, (int, float)) or expires_at < now - leeway_seconds:
            raise PermissionError("Sessao invalida ou expirada")
        if isinstance(not_before, (int, float)) and not_before > now + leeway_seconds:
            raise PermissionError("Sessao invalida ou expirada")
        if issuer != expected_issuer:
            raise PermissionError("Sessao invalida ou expirada")
        if audience != "authenticated" and not (
            isinstance(audience, list) and "authenticated" in audience
        ):
            raise PermissionError("Sessao invalida ou expirada")
        if not payload.get("sub") or not payload.get("email"):
            raise PermissionError("Sessao invalida ou expirada")

    @classmethod
    def _cached_user(cls, cache_key: str, *, max_age: float) -> UserRead | None:
        cached = cls._cache.get(cache_key)
        if cached is None:
            return None
        cached_at, user = cached
        if monotonic() - cached_at > max_age:
            if monotonic() - cached_at > cls._stale_grace_seconds:
                cls._cache.pop(cache_key, None)
            return None
        cls._cache.move_to_end(cache_key)
        return user

    @classmethod
    def _store_cached_user(cls, cache_key: str, user: UserRead) -> None:
        cls._cache[cache_key] = (monotonic(), user)
        cls._cache.move_to_end(cache_key)
        while len(cls._cache) > cls._cache_limit:
            cls._cache.popitem(last=False)

    @staticmethod
    def _to_read_model(payload: dict) -> UserRead:
        email = payload.get("email")
        if not email:
            raise PermissionError("Usuario sem e-mail")

        metadata = payload.get("user_metadata") or {}
        app_metadata = payload.get("app_metadata") or {}
        created_at = datetime.fromisoformat(payload["created_at"].replace("Z", "+00:00"))
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=UTC)

        raw_role = str(app_metadata.get("role") or metadata.get("role") or "FUNCIONARIO")
        try:
            role = UserRole(raw_role.upper())
        except ValueError:
            role = UserRole.FUNCIONARIO
        return UserRead(
            id=payload["id"],
            name=metadata.get("name") or email.split("@", 1)[0],
            email=email,
            role=role,
            active=True,
            scopes=scopes_for_role(role.value),
            created_at=created_at,
        )
