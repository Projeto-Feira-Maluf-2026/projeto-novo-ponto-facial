import asyncio
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from redis.asyncio import Redis
from sqlalchemy import text

from app.core.config import settings
from app.db.session import engine
from app.services.ai.base import FaceProviderState
from app.services.ai.facial_service import get_face_provider

router = APIRouter(tags=["health"])


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
    provider = get_face_provider().info()
    face_ready = provider.state == FaceProviderState.READY and provider.is_real_model
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
        "face_provider": {
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
        },
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
