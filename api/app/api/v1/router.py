from fastapi import APIRouter

from app.api.v1.routes import alerts, attendance, auth, dashboard, devices, employees, reports, worksites
from app.core.runtime import is_lightweight_serverless

if is_lightweight_serverless():
    from app.api.v1.routes import ai_lite as ai
else:
    from app.api.v1.routes import ai

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(dashboard.router, prefix="/dashboard", tags=["dashboard"])
api_router.include_router(employees.router, prefix="/employees", tags=["employees"])
api_router.include_router(worksites.router, prefix="/worksites", tags=["worksites"])
api_router.include_router(devices.router, prefix="/devices", tags=["devices"])
api_router.include_router(attendance.router, prefix="/attendance", tags=["attendance"])
api_router.include_router(reports.router, prefix="/reports", tags=["reports"])
api_router.include_router(alerts.router, prefix="/alerts", tags=["alerts"])
api_router.include_router(ai.router, prefix="/ai", tags=["ai"])
