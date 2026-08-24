from datetime import UTC, datetime

import httpx

from app.core.config import settings
from app.core.permissions import scopes_for_role
from app.models.enums import UserRole
from app.schemas.auth import UserRead


class AuthService:
    async def authenticate(self, access_token: str) -> UserRead:
        headers = {
            "apikey": settings.SUPABASE_PUBLISHABLE_KEY,
            "Authorization": f"Bearer {access_token}",
            "User-Agent": "ponto-facial-api/1.0",
        }
        async with httpx.AsyncClient(
            timeout=settings.HEALTHCHECK_TIMEOUT_SECONDS * 2
        ) as client:
            response = await client.get(
                f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/user",
                headers=headers,
            )
        if response.status_code != 200:
            raise PermissionError("Sessao invalida ou expirada")

        return self._to_read_model(response.json())

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
