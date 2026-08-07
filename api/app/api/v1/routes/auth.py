import secrets

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.session import get_session
from app.models.entities import User
from app.schemas.auth import LoginRequest, RefreshRequest, TokenPair, UserRead
from app.services.auth import AuthService

router = APIRouter()


@router.post("/login", response_model=TokenPair)
async def login(payload: LoginRequest, session: AsyncSession = Depends(get_session)) -> TokenPair:
    try:
        return await AuthService(session).login(payload)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc


@router.post("/refresh", response_model=TokenPair)
async def refresh(payload: RefreshRequest, session: AsyncSession = Depends(get_session)) -> TokenPair:
    try:
        return await AuthService(session).refresh(payload.refresh_token)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc


@router.get("/me", response_model=UserRead)
async def me(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)) -> UserRead:
    return AuthService(session).to_read_model(user)


@router.post("/bootstrap-admin", status_code=204)
async def bootstrap_admin(
    session: AsyncSession = Depends(get_session),
    bootstrap_token: str | None = Header(default=None, alias="X-Bootstrap-Token"),
) -> None:
    service = AuthService(session)
    if settings.ENVIRONMENT in {"development", "test"}:
        await service.ensure_default_admin()
        return
    if not settings.BOOTSTRAP_ADMIN_TOKEN or not bootstrap_token:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recurso nao encontrado")
    if not secrets.compare_digest(bootstrap_token, settings.BOOTSTRAP_ADMIN_TOKEN):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Token de bootstrap invalido")
    if not settings.INITIAL_ADMIN_EMAIL or not settings.INITIAL_ADMIN_PASSWORD:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Credenciais do administrador inicial nao configuradas",
        )
    await service.ensure_admin(
        name=settings.INITIAL_ADMIN_NAME,
        email=settings.INITIAL_ADMIN_EMAIL,
        password=settings.INITIAL_ADMIN_PASSWORD,
    )
