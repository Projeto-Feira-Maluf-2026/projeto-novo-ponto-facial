import httpx
import pytest
from pydantic import ValidationError

from app.main import application as application_under_test
from app.schemas.devices import DeviceCreate
from app.services.devices import describe_camera_source, sanitize_device_metadata


def test_device_responses_never_expose_connection_secrets() -> None:
    metadata = {
        "camera": {
            "camera_type": "RTSP",
            "protocol": "RTSP",
            "ip_address": "10.0.0.20",
            "port": 554,
            "username": "camera-user",
            "password": "private-password",
            "rtsp_url": "rtsp://camera-user:private-password@10.0.0.20/live",
            "location_label": "Portaria",
            "recognition_enabled": True,
            "developer_debug": True,
        },
        "private_vendor_token": "must-not-leak",
    }

    assert sanitize_device_metadata(metadata) == {
        "camera": {
            "camera_type": "RTSP",
            "location_label": "Portaria",
            "recognition_enabled": True,
        }
    }
    assert describe_camera_source(metadata["camera"]["rtsp_url"]) == "rtsp-camera"


def test_device_api_key_has_no_predictable_default() -> None:
    with pytest.raises(ValidationError):
        DeviceCreate(
            worksite_id="worksite-1",
            name="Camera principal",
            serial_number="CAM-001",
        )


def test_api_exposes_no_account_creation_route() -> None:
    auth_routes = {
        path: set(operations)
        for path, operations in application_under_test.openapi()["paths"].items()
        if path.startswith("/api/v1/auth")
    }

    assert auth_routes == {"/api/v1/auth/me": {"get"}}


@pytest.mark.asyncio
async def test_api_responses_disable_storage_and_sniffing() -> None:
    transport = httpx.ASGITransport(app=application_under_test)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get("/api/health/live")

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store, max-age=0"
    assert response.headers["pragma"] == "no-cache"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "no-referrer"
