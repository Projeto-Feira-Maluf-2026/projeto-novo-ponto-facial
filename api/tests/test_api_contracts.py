import httpx
import pytest
from pydantic import ValidationError

from app.core.config import settings
from app.main import app
from app.schemas.ai import FaceIdentifyRequest, FaceVerifyRequest
from app.schemas.enrollment import EnrollmentCaptureRequest
from app.services.ai.facial_service import get_face_provider


@pytest.mark.asyncio
async def test_vercel_api_prefix_reaches_fastapi() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        health = await client.get("/api/health/live")
        protected = await client.get("/api/v1/dashboard")

    assert health.status_code == 200
    assert protected.status_code == 401


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


@pytest.mark.asyncio
async def test_structured_face_error_and_request_id(monkeypatch) -> None:
    monkeypatch.setattr(settings, "ENVIRONMENT", "test")
    monkeypatch.setattr(settings, "FACE_PROVIDER", "fake")
    get_face_provider.cache_clear()
    try:
        transport = httpx.ASGITransport(app=app)
        async with app.router.lifespan_context(app):
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
        transport = httpx.ASGITransport(app=app)
        async with app.router.lifespan_context(app):
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
