from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_scopes
from app.core.permissions import Scope
from app.db.session import get_session
from app.schemas.auth import UserRead
from app.schemas.attendance import AttendanceDecision, AttendanceRead, PunchCreate
from app.services.attendance import AttendanceService

router = APIRouter()


@router.post("/punch", response_model=AttendanceDecision)
async def punch(
    payload: PunchCreate,
    _: UserRead = Depends(require_scopes(Scope.ATTENDANCE_WRITE)),
    session: AsyncSession = Depends(get_session),
) -> AttendanceDecision:
    try:
        return await AttendanceService(session).register_punch(payload)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/history", response_model=list[AttendanceRead])
async def history(
    employee_id: str | None = None,
    worksite_id: str | None = None,
    starts_at: datetime | None = Query(default=None),
    ends_at: datetime | None = Query(default=None),
    _: UserRead = Depends(require_scopes(Scope.ATTENDANCE_READ)),
    session: AsyncSession = Depends(get_session),
) -> list[AttendanceRead]:
    records = await AttendanceService(session).history(employee_id, worksite_id, starts_at, ends_at)
    return [AttendanceRead.model_validate(record) for record in records]
