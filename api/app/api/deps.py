from collections.abc import Callable

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import ROLE_SCOPES, Scope
from app.core.security import decode_token
from app.db.session import get_session
from app.models.entities import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    session: AsyncSession = Depends(get_session),
) -> User:
    try:
        payload = decode_token(token)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    user = await session.get(User, payload["sub"])
    if not user or not user.active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuario inativo")
    return user


def require_scopes(*required: Scope) -> Callable:
    async def dependency(user: User = Depends(get_current_user)) -> User:
        allowed = ROLE_SCOPES.get(user.role.value, set())
        missing = [scope.value for scope in required if scope not in allowed]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"message": "Permissao insuficiente", "missing": missing},
            )
        return user

    return dependency

