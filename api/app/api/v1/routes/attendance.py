from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_scopes
from app.core.config import settings
from app.core.errors import AppError
from app.core.permissions import Scope
from app.core.runtime import is_lightweight_serverless
from app.db.session import get_session
from app.schemas.auth import UserRead
from app.schemas.attendance import (
    AttendanceBatchDecision,
    AttendanceCorrection,
    AttendanceDecision,
    AttendanceRead,
    PunchBatchCreate,
    PunchCreate,
)
from app.models.enums import AttendanceStatus
from app.services.attendance import AttendanceService

router = APIRouter()


@router.post("/punch", response_model=AttendanceDecision)
async def punch(
    payload: PunchCreate,
    current_user: UserRead = Depends(require_scopes(Scope.ATTENDANCE_WRITE)),
    session: AsyncSession = Depends(get_session),
) -> AttendanceDecision:
    if is_lightweight_serverless():
        raise AppError(
            "FACE_RUNTIME_NOT_INSTALLED",
            "Batida biometrica exige o backend de IA em container",
            503,
        )
    try:
        return await AttendanceService(
            session,
            actor_user_id=current_user.id,
        ).register_punch(payload)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/punch/batch", response_model=AttendanceBatchDecision)
async def punch_batch(
    payload: PunchBatchCreate,
    background_tasks: BackgroundTasks,
    current_user: UserRead = Depends(require_scopes(Scope.ATTENDANCE_WRITE)),
    session: AsyncSession = Depends(get_session),
) -> AttendanceBatchDecision:
    """Register every independently cropped face from the same camera frame."""
    if is_lightweight_serverless():
        raise AppError(
            "FACE_RUNTIME_NOT_INSTALLED",
            "Batida biometrica exige o backend de IA em container",
            503,
        )

    service = AttendanceService(
        session,
        actor_user_id=current_user.id,
        defer_email_notifications=True,
    )
    decisions: list[AttendanceDecision] = []
    try:
        for punch_payload in payload.punches:
            decisions.append(await service.register_punch(punch_payload))
        # Uma unica transacao para o grupo inteiro: N rostos custam um commit,
        # nao N. Os e-mails continuam saindo somente depois da gravacao.
        await session.commit()
    except LookupError as exc:
        await session.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except Exception:
        await session.rollback()
        raise

    # O SMTP levava de 1 a 3 segundos e segurava a resposta do terminal (e,
    # portanto, a apresentacao). O registro ja esta gravado; a confirmacao por
    # e-mail sai logo depois da resposta, sem atrasar a leitura.
    queued_record_ids = set(service.pending_email_notifications)
    if queued_record_ids:
        background_tasks.add_task(service.send_pending_email_notifications)
    for decision in decisions:
        if decision.record is not None and decision.record.id in queued_record_ids:
            decision.email_notification_queued = settings.EMAIL_NOTIFICATIONS_ENABLED

    return AttendanceBatchDecision(
        decisions=decisions,
        processed=len(decisions),
        accepted=sum(decision.status == AttendanceStatus.ACCEPTED for decision in decisions),
        manual_review=sum(
            decision.status == AttendanceStatus.MANUAL_REVIEW for decision in decisions
        ),
    )


@router.patch("/{record_id}", response_model=AttendanceRead)
async def correct_attendance(
    record_id: str,
    payload: AttendanceCorrection,
    current_user: UserRead = Depends(require_scopes(Scope.ATTENDANCE_CORRECT)),
    session: AsyncSession = Depends(get_session),
) -> AttendanceRead:
    try:
        record = await AttendanceService(
            session,
            actor_user_id=current_user.id,
        ).correct(record_id, payload)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return AttendanceRead.model_validate(record)


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
