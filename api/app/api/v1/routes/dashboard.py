from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_scopes
from app.core.permissions import Scope
from app.db.session import get_session
from app.models.entities import User
from app.schemas.dashboard import DashboardMetrics
from app.services.dashboard import DashboardService

router = APIRouter()


@router.get("", response_model=DashboardMetrics)
async def metrics(
    _: User = Depends(require_scopes(Scope.DASHBOARD_READ)),
    session: AsyncSession = Depends(get_session),
) -> DashboardMetrics:
    return await DashboardService(session).metrics()

