"""FastAPI application factory and shared middleware configuration."""

import asyncio
import logging
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from app.api.health import router as health_router
from app.api.v1.router import api_router
from app.core.config import settings
from app.core.errors import AppError
from app.core.logging import configure_logging
from app.core.runtime import is_lightweight_serverless
from app.db.session import engine

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    app.state.face_provider = None
    if not is_lightweight_serverless():
        from app.services.ai.facial_service import get_face_provider

        app.state.face_provider = get_face_provider()
        if settings.FACE_EAGER_INITIALIZE:
            await asyncio.to_thread(app.state.face_provider.initialize)
    yield
    await engine.dispose()


async def request_context(request: Request, call_next):
    # Se for uma requisição de preflight do CORS (OPTIONS), ignora as travas de cabeçalho abaixo
    if request.method == "OPTIONS":
        return await call_next(request)
        
    request_id = request.headers.get("X-Request-ID") or str(uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    response.headers["Cache-Control"] = "no-store, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


def _error_payload(request: Request, code: str, message: str, details: object = None) -> dict:
    return {
        "error": {
            "code": code,
            "message": message,
            "request_id": str(getattr(request.state, "request_id", "unknown")),
            "details": details or {},
        }
    }


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=_error_payload(request, str(exc.code), exc.message, exc.details),
    )


async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    errors = [
        {
            "location": [str(part) for part in error["loc"]],
            "type": error["type"],
            "message": error["msg"],
        }
        for error in exc.errors()
    ]
    return JSONResponse(
        status_code=422,
        content=_error_payload(
            request,
            "REQUEST_VALIDATION_FAILED",
            "A requisicao contem campos invalidos",
            {"errors": errors},
        ),
    )


async def http_error_handler(request: Request, exc: HTTPException) -> JSONResponse:
    message = exc.detail if isinstance(exc.detail, str) else "A requisicao nao pode ser processada"
    details = exc.detail if isinstance(exc.detail, dict) else {}
    return JSONResponse(
        status_code=exc.status_code,
        content=_error_payload(request, f"HTTP_{exc.status_code}", message, details),
        headers=exc.headers,
    )


async def unexpected_error_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception(
        "Erro nao tratado request_id=%s exception_type=%s",
        getattr(request.state, "request_id", "unknown"),
        type(exc).__name__,
    )
    return JSONResponse(
        status_code=500,
        content=_error_payload(
            request,
            "INTERNAL_ERROR",
            "Ocorreu um erro interno inesperado",
        ),
    )


def create_application() -> FastAPI:
    service = FastAPI(
        title=settings.PROJECT_NAME,
        version=settings.APP_VERSION,
        description="Controle corporativo de ponto com reconhecimento facial.",
        docs_url=None if settings.ENVIRONMENT == "production" else "/api/docs",
        redoc_url=None if settings.ENVIRONMENT == "production" else "/api/redoc",
        openapi_url=None if settings.ENVIRONMENT == "production" else "/api/openapi.json",
        lifespan=lifespan,
    )
    
    # 1. Configura as origens permitidas explicitamente incluindo o frontend de produção e local
    allowed_origins = list(settings.cors_origins) if settings.cors_origins else []
    production_origins = [
        "https://vercel.app",
        "http://localhost:5174",
        "http://localhost:3000"
    ]
    for origin in production_origins:
        if origin not in allowed_origins:
            allowed_origins.append(origin)

    # 2. Adiciona o CORSMiddleware primeiro para garantir respostas limpas no preflight OPTIONS
    service.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_origin_regex=settings.CORS_ORIGIN_REGEX,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # 3. Middlewares HTTP normais e tratadores de erro entram na sequência
    service.middleware("http")(request_context)
    service.add_exception_handler(AppError, app_error_handler)
    service.add_exception_handler(RequestValidationError, validation_error_handler)
    service.add_exception_handler(HTTPException, http_error_handler)
    service.add_exception_handler(Exception, unexpected_error_handler)
    
    service.include_router(health_router)
    service.include_router(health_router, prefix="/api")
    service.include_router(api_router, prefix=settings.API_V1_PREFIX)
    return service
