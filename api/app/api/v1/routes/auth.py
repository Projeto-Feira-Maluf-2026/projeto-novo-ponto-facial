from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
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
async def bootstrap_admin(session: AsyncSession = Depends(get_session)) -> None:
    await AuthService(session).ensure_default_admin()

