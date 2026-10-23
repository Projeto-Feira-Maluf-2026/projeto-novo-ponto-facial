"""Regressions for the 2026-10-17 round: safe conflicts, stable pages, cameras, corrections."""
from datetime import UTC, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError

from app.api.deps import get_current_user
from app.application import create_application
from app.core import rate_limit
from app.core.config import Settings, _dotenv_files, settings
from app.core.errors import ConflictError, InvalidReferenceError
from app.db.session import get_session
from app.models.enums import UserRole
from app.schemas.attendance import AttendanceCorrection
from app.schemas.devices import CameraConfig, DeviceCreate, DeviceHeartbeat
from app.schemas.employees import EmployeeCreate
from app.schemas.worksites import WorksiteCreate
from app.services.devices import (
    CameraConfigurationError,
    DeviceService,
    camera_config_from_metadata,
    merge_heartbeat_metadata,
    protect_camera_config,
)
from app.services.employees import EmployeeService
from app.services.worksites import WorksiteService

DATABASE_ERROR_TEXT = 'duplicate key value violates unique constraint "employees_registration_key"'


def integrity_error() -> IntegrityError:
    return IntegrityError("INSERT INTO employees (...) VALUES (...)", {}, Exception(DATABASE_ERROR_TEXT))


@pytest.fixture(autouse=True)
def isolated_rate_limit(monkeypatch):
    rate_limit._fallback.clear()
    monkeypatch.setattr(settings, "ENVIRONMENT", "test")
    yield
    rate_limit._fallback.clear()


def test_test_suite_never_reads_developer_dotenv() -> None:
    assert _dotenv_files() == ()
    assert Settings.model_config["env_file"] == ()


async def _post_employee_with(session) -> httpx.Response:
    app = create_application()

    async def current_user():
        return SimpleNamespace(id="admin", role=UserRole.SUPER_ADMIN)

    async def session_dependency():
        yield session

    app.dependency_overrides[get_current_user] = current_user
    app.dependency_overrides[get_session] = session_dependency
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        return await client.post(
            "/api/v1/employees",
            json={"registration": "CE-1", "name": "Pessoa Sintetica", "worksite_ids": ["w-1"]},
        )


@pytest.mark.asyncio
async def test_duplicate_registration_is_a_safe_conflict_without_database_text() -> None:
    session = SimpleNamespace(
        scalars=AsyncMock(return_value=["w-1"]),
        add=MagicMock(),
        flush=AsyncMock(side_effect=integrity_error()),
        rollback=AsyncMock(),
        commit=AsyncMock(),
    )

    response = await _post_employee_with(session)

    assert response.status_code == 409
    body = response.json()
    assert body["error"]["code"] == "EMPLOYEE_REGISTRATION_CONFLICT"
    assert "duplicate key" not in response.text
    assert "INSERT" not in response.text
    session.rollback.assert_awaited_once()
    session.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_unknown_worksite_is_rejected_before_any_write() -> None:
    session = SimpleNamespace(
        scalars=AsyncMock(return_value=[]),
        add=MagicMock(),
        flush=AsyncMock(),
        commit=AsyncMock(),
    )

    response = await _post_employee_with(session)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "WORKSITE_NOT_FOUND"
    session.add.assert_not_called()
    session.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_repeated_worksite_ids_are_linked_once() -> None:
    session = SimpleNamespace(scalars=AsyncMock(return_value=["w-1"]))
    assert await EmployeeService(session)._existing_worksite_ids(["w-1", "w-1"]) == ["w-1"]


def test_employee_text_fields_are_bounded() -> None:
    with pytest.raises(ValidationError):
        EmployeeCreate(registration="CE-1", name="Pessoa", document="9" * 33)
    with pytest.raises(ValidationError):
        EmployeeCreate(registration="CE-1", name="Pessoa", worksite_ids=["w"] * 101)
    with pytest.raises(ValidationError):
        WorksiteCreate(name="Obra", code="OB", address="Rua sintetica", manager_name="x" * 161)


@pytest.mark.asyncio
async def test_duplicate_worksite_code_and_device_serial_are_conflicts() -> None:
    worksite_session = SimpleNamespace(
        add=MagicMock(), commit=AsyncMock(side_effect=integrity_error()), rollback=AsyncMock()
    )
    with pytest.raises(ConflictError) as worksite_error:
        await WorksiteService(worksite_session).create(
            WorksiteCreate(name="Obra", code="OB-1", address="Rua sintetica 1")
        )
    assert worksite_error.value.status_code == 409
    worksite_session.rollback.assert_awaited_once()

    device_session = SimpleNamespace(
        scalar=AsyncMock(return_value="w-1"),
        add=MagicMock(),
        commit=AsyncMock(side_effect=integrity_error()),
        rollback=AsyncMock(),
    )
    with pytest.raises(ConflictError):
        await DeviceService(device_session).create(
            DeviceCreate(worksite_id="w-1", name="Camera", serial_number="CAM-1", api_key="k" * 32)
        )


@pytest.mark.asyncio
async def test_device_for_unknown_worksite_is_rejected() -> None:
    session = SimpleNamespace(scalar=AsyncMock(return_value=None), add=MagicMock())
    with pytest.raises(InvalidReferenceError):
        await DeviceService(session).create(
            DeviceCreate(worksite_id="missing", name="Camera", serial_number="CAM-1", api_key="k" * 32)
        )
    session.add.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("service_factory", "expected"),
    [
        (lambda session: EmployeeService(session).list(page=2, size=1), "employees.name, employees.id"),
        (lambda session: WorksiteService(session).list(page=2, size=1), "worksites.name, worksites.id"),
        (
            lambda session: DeviceService(session).list(page=2, size=1),
            "capture_devices.name, capture_devices.id",
        ),
    ],
)
async def test_offset_pages_use_a_unique_order(service_factory, expected) -> None:
    session = SimpleNamespace(scalar=AsyncMock(return_value=3), scalars=AsyncMock(return_value=[]))
    await service_factory(session)
    statement = session.scalars.await_args.args[0]
    assert f"ORDER BY {expected}" in str(statement)


@pytest.mark.parametrize(
    "camera",
    [
        {"protocol": "RTSP", "rtsp_url": "/etc/passwd"},
        {"protocol": "RTSP", "rtsp_url": "file:///etc/passwd"},
        {"protocol": "RTSP", "rtsp_url": "img_%02d.jpg"},
        {"protocol": "RTSP", "rtsp_url": "videotestsrc ! appsink"},
        {"protocol": "HTTP", "rtsp_url": "http://169.254.169.254/latest/meta-data/"},
        {"protocol": "HTTP", "rtsp_url": "http://localhost:6379/"},
        {"protocol": "HTTP", "ip_address": "127.0.0.1"},
        {"protocol": "HTTP", "ip_address": "metadata.google.internal"},
        {"protocol": "RTSP", "ip_address": "10.0.0.2/stream"},
        {"protocol": "GSTREAMER"},
    ],
)
def test_camera_sources_reject_paths_pipelines_and_host_metadata(camera) -> None:
    with pytest.raises(ValidationError):
        CameraConfig(camera_type="IP", **camera)


@pytest.mark.parametrize(
    "host",
    ["2130706433", "0x7f000001", "127.1", "017700000001", "::ffff:127.0.0.1", "0.1.2.3", "fd00:ec2::254"],
)
def test_alternate_loopback_notations_cannot_bypass_the_host_check(host) -> None:
    # libc/FFmpeg resolve these to 127.0.0.1 or a metadata address.
    with pytest.raises(ValidationError):
        CameraConfig(camera_type="IP", protocol="RTSP", ip_address=host)
    with pytest.raises(ValidationError):
        CameraConfig(camera_type="IP", protocol="RTSP", rtsp_url=f"rtsp://[{host}]/" if ":" in host else f"rtsp://{host}/")


def test_camera_name_resolving_to_loopback_is_refused_before_connecting(monkeypatch) -> None:
    import socket

    from app.services import devices as device_service

    def resolve(host, *_args, **_kwargs):
        target = "127.0.0.1" if host == "cam.rebind.example" else "192.168.0.50"
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (target, 0))]

    monkeypatch.setattr(device_service.socket, "getaddrinfo", resolve)
    rebinding = CameraConfig(camera_type="IP", protocol="RTSP", ip_address="cam.rebind.example")
    with pytest.raises(CameraConfigurationError):
        device_service.ensure_source_reaches_allowed_hosts(device_service.build_camera_source(rebinding))

    lan = CameraConfig(camera_type="IP", protocol="RTSP", ip_address="cam.obra.local")
    device_service.ensure_source_reaches_allowed_hosts(device_service.build_camera_source(lan))
    device_service.ensure_source_reaches_allowed_hosts(0)


def test_camera_on_private_lan_and_blank_form_fields_remain_valid() -> None:
    config = CameraConfig(
        camera_type="ip", protocol="rtsp", ip_address="192.168.0.120", port=554,
        username="", password="", rtsp_url="",
    )
    assert config.protocol == "RTSP"
    assert config.username is None and config.password is None and config.rtsp_url is None
    assert CameraConfig(rtsp_url="rtsps://cam.obra.local:322/live").rtsp_url


def test_camera_secrets_are_encrypted_at_rest_and_still_usable() -> None:
    config = CameraConfig(
        camera_type="IP", protocol="RTSP", ip_address="10.0.0.20",
        password="private-password", rtsp_url="rtsp://user:private-password@10.0.0.20/live",
    )
    stored = protect_camera_config(config)

    assert "private-password" not in str(stored)
    assert "password" not in stored and "rtsp_url" not in stored
    restored = camera_config_from_metadata({"camera": stored})
    assert restored.password == "private-password"
    assert restored.rtsp_url == "rtsp://user:private-password@10.0.0.20/live"

    legacy = camera_config_from_metadata({"camera": {"protocol": "RTSP", "password": "legacy"}})
    assert legacy.password == "legacy"


def test_tampered_or_disallowed_stored_camera_fails_closed() -> None:
    with pytest.raises(CameraConfigurationError):
        camera_config_from_metadata({"camera": {"protocol": "RTSP", "password_encrypted": "not-a-token"}})
    with pytest.raises(CameraConfigurationError):
        camera_config_from_metadata({"camera": {"protocol": "RTSP", "rtsp_url": "/etc/passwd"}})


def test_heartbeat_cannot_replace_or_erase_camera_settings() -> None:
    stored = {"camera": {"protocol": "RTSP", "ip_address": "10.0.0.20"}, "heartbeat": {"old": 1}}
    merged = merge_heartbeat_metadata(stored, {"camera": {"rtsp_url": "/etc/passwd"}, "battery": 80})

    assert merged["camera"] == stored["camera"]
    assert merged["heartbeat"] == {"battery": 80}
    assert merge_heartbeat_metadata(stored, None) == {"camera": stored["camera"]}
    with pytest.raises(ValidationError):
        DeviceHeartbeat(serial_number="CAM-1", api_key="k", metadata_json={"blob": "x" * 5000})


@pytest.mark.asyncio
async def test_snapshot_failure_does_not_echo_stream_details(monkeypatch) -> None:
    app = create_application()
    device = SimpleNamespace(id="d-1", metadata_json={"camera": {"protocol": "RTSP", "ip_address": "10.0.0.2"}})

    def failing_capture(_config):
        raise ConnectionError("rtsp://user:private-password@10.0.0.2/ unreachable")

    monkeypatch.setattr("app.api.v1.routes.devices.read_camera_jpeg", failing_capture)
    status_updates = AsyncMock()
    monkeypatch.setattr(DeviceService, "update_connection_status", status_updates)

    async def current_user():
        return SimpleNamespace(id="admin", role=UserRole.SUPER_ADMIN)

    async def session_dependency():
        yield SimpleNamespace(get=AsyncMock(return_value=device))

    app.dependency_overrides[get_current_user] = current_user
    app.dependency_overrides[get_session] = session_dependency
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/v1/devices/d-1/snapshot")

    assert response.status_code == 503
    assert "private-password" not in response.text
    assert "rtsp://" not in response.text
    status_updates.assert_awaited_once()


def test_correction_requires_explicit_offset_and_rejects_future() -> None:
    with pytest.raises(ValidationError):
        AttendanceCorrection(reason="Ajuste", occurred_at=datetime(2026, 10, 1, 8, 0))
    with pytest.raises(ValidationError):
        AttendanceCorrection(reason="Ajuste", occurred_at=datetime.now(UTC) + timedelta(hours=1))

    sao_paulo = timezone(timedelta(hours=-3))
    correction = AttendanceCorrection(reason="Ajuste", occurred_at=datetime(2026, 10, 1, 8, 0, tzinfo=sao_paulo))
    assert correction.occurred_at.utcoffset() == timedelta(hours=-3)
