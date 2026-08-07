from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_scopes
from app.core.permissions import Scope
from app.db.session import get_session
from app.models.entities import User
from app.schemas.reports import ReportRequest
from app.services.reports import ReportService

router = APIRouter()


@router.post("/export")
async def export_report(
    payload: ReportRequest,
    _: User = Depends(require_scopes(Scope.REPORTS_EXPORT)),
    session: AsyncSession = Depends(get_session),
) -> Response:
    content, media_type, filename = await ReportService(session).export(payload)
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

