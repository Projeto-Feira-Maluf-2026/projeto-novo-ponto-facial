import hashlib
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import scopes_for_role
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    password_hash,
    verify_password,
)
from app.models.entities import RefreshToken, User
from app.models.enums import UserRole
from app.schemas.auth import LoginRequest, TokenPair, UserRead


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class AuthService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def login(self, payload: LoginRequest) -> TokenPair:
        user = await self.session.scalar(select(User).where(User.email == payload.email))
        if not user or not user.active or not verify_password(payload.password, user.password_hash):
            raise PermissionError("Credenciais invalidas")

        scopes = scopes_for_role(user.role.value)
        access = create_access_token(user.id, user.role.value, scopes)
        refresh, expires_at = create_refresh_token(user.id)
        self.session.add(
            RefreshToken(
                user_id=user.id,
                token_hash=token_hash(refresh),
                expires_at=expires_at.replace(tzinfo=None),
                device_label=payload.device_label,
            )
        )
        await self.session.commit()
        return TokenPair(
            access_token=access,
            refresh_token=refresh,
            expires_in=15 * 60,
        )

    async def refresh(self, refresh_token: str) -> TokenPair:
        decoded = decode_token(refresh_token, expected_type="refresh")
        stored = await self.session.scalar(
            select(RefreshToken).where(RefreshToken.token_hash == token_hash(refresh_token))
        )
        if not stored or stored.revoked_at or stored.expires_at < datetime.utcnow():
            raise PermissionError("Refresh token invalido")
        user = await self.session.get(User, decoded["sub"])
        if not user or not user.active:
            raise PermissionError("Usuario inativo")
        stored.revoked_at = datetime.utcnow()
        scopes = scopes_for_role(user.role.value)
        access = create_access_token(user.id, user.role.value, scopes)
        new_refresh, expires_at = create_refresh_token(user.id)
        self.session.add(
            RefreshToken(
                user_id=user.id,
                token_hash=token_hash(new_refresh),
                expires_at=expires_at.replace(tzinfo=None),
            )
        )
        await self.session.commit()
        return TokenPair(access_token=access, refresh_token=new_refresh, expires_in=15 * 60)

    async def ensure_admin(self, *, name: str, email: str, password: str) -> None:
        exists = await self.session.scalar(select(User).where(User.email == email))
        if exists:
            return
        self.session.add(
            User(
                name=name,
                email=email,
                password_hash=password_hash(password),
                role=UserRole.SUPER_ADMIN,
            )
        )
        await self.session.commit()

    async def ensure_default_admin(self) -> None:
        await self.ensure_admin(
            name="Administrador",
            email="admin@curitibaempreiteira.com",
            password="Admin@12345",
        )

    def to_read_model(self, user: User) -> UserRead:
        return UserRead(
            id=user.id,
            name=user.name,
            email=user.email,
            role=user.role,
            active=user.active,
            scopes=scopes_for_role(user.role.value),
            created_at=user.created_at,
        )
