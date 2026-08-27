from collections import OrderedDict
from datetime import UTC, datetime
from hashlib import sha256
from time import monotonic

import httpx

from app.core.config import settings
from app.core.errors import AppError
from app.core.permissions import scopes_for_role
from app.models.enums import UserRole
from app.schemas.auth import UserRead


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
