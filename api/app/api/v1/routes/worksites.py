from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_scopes
from app.core.permissions import Scope
from app.db.session import get_session
from app.schemas.auth import UserRead
from app.schemas.common import Page
from app.schemas.worksites import WorksiteCreate, WorksiteRead, WorksiteUpdate
from app.services.worksites import WorksiteService

router = APIRouter()


@router.get("", response_model=Page[WorksiteRead])
async def list_worksites(
    page: int = Query(default=1, ge=1),
    size: int = Query(default=50, ge=1, le=200),
    _: UserRead = Depends(require_scopes(Scope.WORKSITES_READ)),
    session: AsyncSession = Depends(get_session),
) -> Page[WorksiteRead]:
    items, total = await WorksiteService(session).list(page=page, size=size)
    return Page(items=[WorksiteRead.model_validate(item) for item in items], total=total, page=page, size=size)


@router.post("", response_model=WorksiteRead, status_code=status.HTTP_201_CREATED)
async def create_worksite(
    payload: WorksiteCreate,
    _: UserRead = Depends(require_scopes(Scope.WORKSITES_WRITE)),
    session: AsyncSession = Depends(get_session),
) -> WorksiteRead:
    worksite = await WorksiteService(session).create(payload)
    return WorksiteRead.model_validate(worksite)


@router.patch("/{worksite_id}", response_model=WorksiteRead)
async def update_worksite(
    worksite_id: str,
    payload: WorksiteUpdate,
    _: UserRead = Depends(require_scopes(Scope.WORKSITES_WRITE)),
    session: AsyncSession = Depends(get_session),
) -> WorksiteRead:
    try:
        worksite = await WorksiteService(session).update(worksite_id, payload)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return WorksiteRead.model_validate(worksite)
