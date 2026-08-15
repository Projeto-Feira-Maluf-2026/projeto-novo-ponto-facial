import asyncio
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse, RedirectResponse
from redis.asyncio import Redis
from sqlalchemy import text

from app.core.config import settings
from app.core.runtime import is_lightweight_serverless
from app.db.session import engine

router = APIRouter(tags=["health"])


@router.get("/", include_in_schema=False)
async def service_root() -> RedirectResponse:
    """Send people who open the API domain to the administrative frontend."""
    return RedirectResponse(url=settings.FRONTEND_URL, status_code=302)


async def _database_health() -> dict[str, Any]:
    try:
        async with asyncio.timeout(settings.HEALTHCHECK_TIMEOUT_SECONDS):
            async with engine.connect() as connection:
                value = await connection.scalar(text("SELECT 1"))
        return {"healthy": value == 1}
    except Exception as exc:
        return {"healthy": False, "error": type(exc).__name__}


async def _redis_health() -> dict[str, Any]:
    client = Redis.from_url(settings.REDIS_URL, socket_timeout=settings.HEALTHCHECK_TIMEOUT_SECONDS)
    try:
        async with asyncio.timeout(settings.HEALTHCHECK_TIMEOUT_SECONDS):
            healthy = bool(await client.ping())
        return {"healthy": healthy, "required": settings.REDIS_REQUIRED}
    except Exception as exc:
        return {
            "healthy": False,
            "required": settings.REDIS_REQUIRED,
            "error": type(exc).__name__,
        }
    finally:
        await client.aclose()


async def health_snapshot() -> dict[str, Any]:
    database, redis_health = await asyncio.gather(_database_health(), _redis_health())
    if is_lightweight_serverless():
        face_ready = False
        face_provider = {
            "healthy": False,
            "state": "RUNTIME_NOT_INSTALLED",
            "provider": settings.FACE_PROVIDER,
            "real_model": False,
            "model_name": None,
            "model_version": None,
            "detector_name": None,
            "normalization_version": None,
            "execution_provider": None,
            "embedding_dimension": None,
            "warmup_ms": None,
            "failure": {
                "code": "RUNTIME_NOT_INSTALLED",
                "message": "Runtime facial nao faz parte da Function serverless leve",
                "details": {"deployment": "vercel"},
            },
        }
    else:
        from app.services.ai.base import FaceProviderState
        from app.services.ai.facial_service import get_face_provider

        provider = get_face_provider().info()
        face_ready = provider.state == FaceProviderState.READY and provider.is_real_model
        face_provider = {
            "healthy": face_ready,
            "state": provider.state.value,
            "provider": provider.provider_name,
            "real_model": provider.is_real_model,
            "model_name": provider.model_name,
            "model_version": provider.model_version,
            "detector_name": provider.detector_name,
            "normalization_version": provider.normalization_version,
            "execution_provider": provider.execution_provider,
            "embedding_dimension": provider.embedding_dimension,
            "warmup_ms": provider.warmup_ms,
            "failure": (
                {
                    "code": provider.failure.code.value,
                    "message": provider.failure.message,
                    "details": provider.failure.details,
                }
                if provider.failure
                else None
            ),
        }
    thresholds_ready = settings.FACE_THRESHOLDS_CALIBRATED or settings.ENVIRONMENT in {
        "development",
        "test",
    }
    ready = (
        bool(database["healthy"])
        and face_ready
        and thresholds_ready
        and (bool(redis_health["healthy"]) or not settings.REDIS_REQUIRED)
    )
    return {
        "status": "ready" if ready else "not_ready",
        "ready": ready,
        "api": {
            "healthy": True,
            "version": settings.APP_VERSION,
            "build": settings.BUILD_ID,
            "environment": settings.ENVIRONMENT,
        },
        "database": database,
        "redis": redis_health,
        "face_provider": face_provider,
        "thresholds": {
            "profile": settings.FACE_THRESHOLD_PROFILE,
            "calibrated": settings.FACE_THRESHOLDS_CALIBRATED,
            "allowed_for_environment": thresholds_ready,
        },
    }


@router.get("/health/live")
async def liveness() -> dict[str, Any]:
    return {
        "status": "alive",
        "service": "ponto-facial-api",
        "version": settings.APP_VERSION,
        "build": settings.BUILD_ID,
    }


@router.get("/health")
async def health() -> dict[str, Any]:
    return await health_snapshot()


@router.get("/health/ready")
async def readiness() -> JSONResponse:
    snapshot = await health_snapshot()
    return JSONResponse(status_code=200 if snapshot["ready"] else 503, content=snapshot)
