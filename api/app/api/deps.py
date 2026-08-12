from collections.abc import Callable

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from app.core.permissions import ROLE_SCOPES, Scope
from app.schemas.auth import UserRead
from app.services.auth import AuthService

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/v1/token")


async def get_current_user(
    token: str = Depends(oauth2_scheme),
) -> UserRead:
    try:
        return await AuthService().authenticate(token)
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


def require_scopes(*required: Scope) -> Callable:
    async def dependency(user: UserRead = Depends(get_current_user)) -> UserRead:
        allowed = ROLE_SCOPES.get(user.role.value, set())
        missing = [scope.value for scope in required if scope not in allowed]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"message": "Permissao insuficiente", "missing": missing},
            )
        return user

    return dependency
