from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_scopes
from app.core.permissions import Scope
from app.db.session import get_session
from app.models.entities import AuditLog
from app.schemas.audit import AuditLogRead
from app.schemas.auth import UserRead
from app.schemas.common import Page

router = APIRouter()


@router.get("", response_model=Page[AuditLogRead])
async def list_audit_logs(
    action: str | None = None,
    entity: str | None = None,
    page: int = Query(default=1, ge=1),
    size: int = Query(default=50, ge=1, le=200),
    _: UserRead = Depends(require_scopes(Scope.AUDIT_READ)),
    session: AsyncSession = Depends(get_session),
) -> Page[AuditLogRead]:
    conditions = []
    if action:
        conditions.append(AuditLog.action == action)
    if entity:
        conditions.append(AuditLog.entity == entity)

    statement = select(AuditLog)
    count_statement = select(func.count(AuditLog.id))
    if conditions:
        statement = statement.where(*conditions)
        count_statement = count_statement.where(*conditions)
    statement = statement.order_by(desc(AuditLog.created_at)).offset((page - 1) * size).limit(size)

    items = list(await session.scalars(statement))
    total = int(await session.scalar(count_statement) or 0)
    return Page(
        items=[AuditLogRead.model_validate(item) for item in items],
        total=total,
        page=page,
        size=size,
    )
