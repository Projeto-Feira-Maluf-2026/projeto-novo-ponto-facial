from fastapi import APIRouter, Depends

from app.api.deps import get_current_user
from app.schemas.auth import UserRead

router = APIRouter()


@router.get("/me", response_model=UserRead)
async def me(user: UserRead = Depends(get_current_user)) -> UserRead:
    return user
