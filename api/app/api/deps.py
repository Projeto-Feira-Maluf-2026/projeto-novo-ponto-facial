from typing import Annotated
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from app.core.services import AuthService
from app.schemas.auth import UserRead

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/v1/auth/login")

async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    auth_service: Annotated[AuthService, Depends()]
) -> UserRead:
    try:
        # Autentica o token usando o AuthService que já alteramos
        user = await auth_service.authenticate(token)
        
        # REMOVIDO: Qualquer verificação restrita como "if user.role != UserRole.ADMIN"
        # Agora o usuário apenas precisa existir e estar ativo no Supabase
        
        return user
    except PermissionError as e:
        raise HTTPException(
            status_code=status.HTTP_01_UNAUTHORIZED,
            detail=str(e),
            headers={"WWW-Authenticate": "Bearer"},
        )
