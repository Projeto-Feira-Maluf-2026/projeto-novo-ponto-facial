from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_scopes
from app.core.permissions import Scope
from app.db.session import get_session
from app.models.entities import SuspiciousAttempt
from app.schemas.auth import UserRead

router = APIRouter()


@router.get("")
async def alerts(
    limit: int = Query(default=50, ge=1, le=200),
    _: UserRead = Depends(require_scopes(Scope.ALERTS_READ)),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    result = await session.scalars(select(SuspiciousAttempt).order_by(desc(SuspiciousAttempt.created_at)).limit(limit))
    return [
        {
            "id": item.id,
            "employee_id": item.employee_id,
            "worksite_id": item.worksite_id,
            "device_id": item.device_id,
            "fraud_type": item.fraud_type.value,
            "severity": item.severity.value,
            "confidence_score": item.confidence_score,
            "details": item.details,
            "created_at": item.created_at,
            "resolved_at": item.resolved_at,
        }
        for item in result
    ]
