import httpx
import pytest
from pydantic import ValidationError
from unittest.mock import AsyncMock
from types import SimpleNamespace

from app.api.v1.routes import ai as ai_routes
from app.api.health import health_snapshot
from app.application import create_application
from app.core.config import settings
from app.schemas.ai import (
    FaceIdentifyBatchRequest,
    FaceIdentifyRequest,
    FaceIdentifyResponse,
    FaceVerifyRequest,
)
from app.schemas.enrollment import EnrollmentCaptureRequest
from app.schemas.reports import ReportRequest
from app.services.ai.facial_service import get_face_provider


application_under_test = create_application()


@pytest.mark.asyncio
async def test_vercel_api_prefix_reaches_fastapi() -> None:
    transport = httpx.ASGITransport(app=application_under_test)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        health = await client.get("/api/health/live")
        protected = await client.get("/api/v1/dashboard")

    assert health.status_code == 200
    assert protected.status_code == 401


@pytest.mark.asyncio
async def test_service_root_redirects_to_the_frontend() -> None:
    transport = httpx.ASGITransport(app=application_under_test)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get("/")

    assert response.status_code == 302
    assert response.headers["location"] == settings.FRONTEND_URL


def test_identification_and_verification_contracts_are_separate() -> None:
    with pytest.raises(ValidationError):
        FaceIdentifyRequest(image_base64="data:image/jpeg;base64,abc", employee_id="employee-1")
    with pytest.raises(ValidationError):
        FaceVerifyRequest(image_base64="data:image/jpeg;base64,abc", worksite_id="worksite-1")

    identification = FaceIdentifyRequest(
        image_base64="data:image/jpeg;base64,abc",
        worksite_id="worksite-1",
    )
    verification = FaceVerifyRequest(
        image_base64="data:image/jpeg;base64,abc",
        employee_id="employee-1",
    )
    assert identification.worksite_id == "worksite-1"
    assert verification.employee_id == "employee-1"


def test_batch_identification_accepts_up_to_five_independent_faces() -> None:
    image = "data:image/jpeg;base64,abc"
    payload = FaceIdentifyBatchRequest(
        images_base64=[image, image],
        worksite_id="worksite-1",
    )
    assert len(payload.images_base64) == 2

    with pytest.raises(ValidationError):
        FaceIdentifyBatchRequest(images_base64=[], worksite_id="worksite-1")
    with pytest.raises(ValidationError):
        FaceIdentifyBatchRequest(images_base64=[image] * 6, worksite_id="worksite-1")


@pytest.mark.asyncio
async def test_batch_identification_returns_two_distinct_people(monkeypatch) -> None:
    recognized = [
        FaceIdentifyResponse.model_construct(matched=True, employee_id="employee-1"),
        FaceIdentifyResponse.model_construct(matched=True, employee_id="employee-2"),
    ]
    identify_mock = AsyncMock(side_effect=recognized)
    monkeypatch.setattr(ai_routes, "identify_face", identify_mock)

    response = await ai_routes.identify_faces(
        FaceIdentifyBatchRequest(
            images_base64=[
                "data:image/jpeg;base64,face-one",
                "data:image/jpeg;base64,face-two",
            ],
            worksite_id="worksite-1",
        ),
        SimpleNamespace(),
        SimpleNamespace(id="operator-1"),
        SimpleNamespace(),
    )

    assert [result.employee_id for result in response.results] == ["employee-1", "employee-2"]
    assert identify_mock.await_count == 2


def test_enrollment_capture_requires_timezone_and_burst() -> None:
    frame = {
        "image_base64": "data:image/jpeg;base64,abc",
        "captured_at": "2026-07-17T12:00:00-03:00",
    }
    capture = EnrollmentCaptureRequest(
        step_index=0,
        pose="FRONTAL",
        frames=[frame, {**frame, "captured_at": "2026-07-17T12:00:00.150-03:00"}, {**frame, "captured_at": "2026-07-17T12:00:00.300-03:00"}],
    )
    assert len(capture.frames) == 3

    with pytest.raises(ValidationError):
        EnrollmentCaptureRequest(
            step_index=0,
            pose="FRONTAL",
            frames=[frame, frame],
        )
    with pytest.raises(ValidationError):
        EnrollmentCaptureRequest(
            step_index=0,
            pose="FRONTAL",
            frames=[{**frame, "captured_at": "2026-07-17T12:00:00"}] * 3,
        )


def test_report_contract_rejects_invalid_period_and_missing_scope() -> None:
    base = {
        "format": "pdf",
        "starts_at": "2026-08-14T00:00:00-03:00",
        "ends_at": "2026-08-14T23:59:59-03:00",
    }
    assert ReportRequest(kind="daily", **base).kind.value == "daily"

    with pytest.raises(ValidationError):
        ReportRequest(
            kind="custom",
            format="pdf",
            starts_at="2026-08-15T00:00:00-03:00",
            ends_at="2026-08-14T00:00:00-03:00",
        )
    with pytest.raises(ValidationError):
        ReportRequest(kind="employee", **base)
    with pytest.raises(ValidationError):
        ReportRequest(kind="worksite", **base)


@pytest.mark.asyncio
async def test_structured_face_error_and_request_id(monkeypatch) -> None:
    monkeypatch.setattr(settings, "ENVIRONMENT", "test")
    monkeypatch.setattr(settings, "FACE_PROVIDER", "fake")
    get_face_provider.cache_clear()
    try:
        transport = httpx.ASGITransport(app=application_under_test)
        async with application_under_test.router.lifespan_context(application_under_test):
            async with httpx.AsyncClient(
                transport=transport,
                base_url="http://testserver",
            ) as client:
                response = await client.post(
                    "/api/v1/ai/analyze-face",
                    json={"image_base64": "this-is-not-base64-data"},
                    headers={"X-Request-ID": "test-request-id"},
                )

        assert response.status_code == 422
        assert response.headers["X-Request-ID"] == "test-request-id"
        assert response.json() == {
            "error": {
                "code": "INVALID_BASE64",
                "message": "Imagem base64 invalida",
                "request_id": "test-request-id",
                "details": {},
            }
        }
    finally:
        get_face_provider.cache_clear()


@pytest.mark.asyncio
async def test_fake_provider_never_makes_readiness_healthy(monkeypatch) -> None:
    monkeypatch.setattr(settings, "ENVIRONMENT", "test")
    monkeypatch.setattr(settings, "FACE_PROVIDER", "fake")
    get_face_provider.cache_clear()
    try:
        transport = httpx.ASGITransport(app=application_under_test)
        async with application_under_test.router.lifespan_context(application_under_test):
            async with httpx.AsyncClient(
                transport=transport,
                base_url="http://testserver",
            ) as client:
                live = await client.get("/health/live")
                ready = await client.get("/health/ready")

        assert live.status_code == 200
        assert ready.status_code == 503
        assert ready.json()["face_provider"]["real_model"] is False
        assert ready.json()["face_provider"]["healthy"] is False
    finally:
        get_face_provider.cache_clear()


@pytest.mark.asyncio
async def test_lightweight_gateway_is_ready_when_database_is_healthy(monkeypatch) -> None:
    monkeypatch.setattr("app.api.health.is_lightweight_serverless", lambda: True)
    monkeypatch.setattr(
        "app.api.health._database_health",
        AsyncMock(return_value={"healthy": True}),
    )
    monkeypatch.setattr(
        "app.api.health._redis_health",
        AsyncMock(return_value={"healthy": False, "required": False}),
    )

    snapshot = await health_snapshot()

    assert snapshot["ready"] is True
    assert snapshot["status"] == "ready"
    assert snapshot["face_provider"]["delegated"] is True
    assert snapshot["face_provider"]["healthy"] is False
