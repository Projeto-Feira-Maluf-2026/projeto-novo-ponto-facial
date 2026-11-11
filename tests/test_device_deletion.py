from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from app.api.deps import get_current_user
from app.application import create_application
from app.db.session import get_session
from app.models.enums import UserRole
from app.services.devices import DeviceService


def session_mock(device=SimpleNamespace(id="cam-1"), execute=None) -> MagicMock:
    return MagicMock(
        get=AsyncMock(return_value=device),
        execute=execute or AsyncMock(),
        commit=AsyncMock(),
        rollback=AsyncMock(),
    )


@pytest.mark.asyncio
async def test_delete_keeps_history_and_removes_only_the_camera() -> None:
    session = session_mock()

    await DeviceService(session).delete("cam-1")

    statements = [str(call.args[0]) for call in session.execute.await_args_list]
    updated = {s.split("UPDATE ", 1)[1].split(" ", 1)[0] for s in statements if s.startswith("UPDATE ")}
    deleted = {s.split("DELETE FROM ", 1)[1].split(" ", 1)[0] for s in statements if s.startswith("DELETE FROM ")}
    assert updated == {"attendance_records", "suspicious_attempts"}
    assert deleted == {"capture_devices"}
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_delete_rolls_back_on_failure() -> None:
    session = session_mock(execute=AsyncMock(side_effect=RuntimeError("db down")))

    with pytest.raises(RuntimeError):
        await DeviceService(session).delete("cam-1")

    session.rollback.assert_awaited_once()
    session.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_delete_unknown_camera_returns_404() -> None:
    app = create_application()

    async def current_user():
        return SimpleNamespace(id="admin", role=UserRole.SUPER_ADMIN)

    async def session_dependency():
        yield session_mock(device=None)

    app.dependency_overrides[get_current_user] = current_user
    app.dependency_overrides[get_session] = session_dependency
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.delete("/api/v1/devices/nao-existe")

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_delete_requires_devices_write() -> None:
    app = create_application()

    async def current_user():
        return SimpleNamespace(id="gestor", role=UserRole.GESTOR_OBRA)

    async def session_dependency():
        yield session_mock()

    app.dependency_overrides[get_current_user] = current_user
    app.dependency_overrides[get_session] = session_dependency
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.delete("/api/v1/devices/cam-1")

    assert response.status_code == 403
