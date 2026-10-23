import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_scopes
from app.core.permissions import Scope
from app.db.session import get_session
from app.models.entities import CaptureDevice
from app.schemas.auth import UserRead
from app.models.enums import DeviceStatus
from app.schemas.common import Page
from app.schemas.devices import CameraTestRequest, CameraTestResponse, DeviceCreate, DeviceHeartbeat, DeviceRead
from app.services.devices import (
    CameraConfigurationError,
    DeviceService,
    camera_config_from_metadata,
    read_camera_jpeg,
    sanitize_device_metadata,
    test_camera_connection,
)

router = APIRouter()
logger = logging.getLogger(__name__)
INVALID_STORED_CAMERA = "Configuracao salva da camera invalida. Cadastre a camera novamente."


def stored_camera_config(device):
    try:
        return camera_config_from_metadata(device.metadata_json)
    except CameraConfigurationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=INVALID_STORED_CAMERA) from exc


def to_device_read(device) -> DeviceRead:
    read = DeviceRead.model_validate(device)
    read.metadata_json = sanitize_device_metadata(read.metadata_json)
    return read


@router.get("", response_model=Page[DeviceRead])
async def list_devices(
    page: int = Query(default=1, ge=1),
    size: int = Query(default=50, ge=1, le=200),
    _: UserRead = Depends(require_scopes(Scope.DEVICES_READ)),
    session: AsyncSession = Depends(get_session),
) -> Page[DeviceRead]:
    items, total = await DeviceService(session).list(page=page, size=size)
    return Page(items=[to_device_read(item) for item in items], total=total, page=page, size=size)


@router.post("", response_model=DeviceRead, status_code=status.HTTP_201_CREATED)
async def create_device(
    payload: DeviceCreate,
    _: UserRead = Depends(require_scopes(Scope.DEVICES_WRITE)),
    session: AsyncSession = Depends(get_session),
) -> DeviceRead:
    device = await DeviceService(session).create(payload)
    return to_device_read(device)


@router.post("/test-camera", response_model=CameraTestResponse)
async def test_camera(
    payload: CameraTestRequest,
    _: UserRead = Depends(require_scopes(Scope.DEVICES_WRITE)),
) -> CameraTestResponse:
    # OpenCV blocks while it connects; keep the event loop free for other requests.
    return await asyncio.to_thread(test_camera_connection, payload.camera)


@router.post("/heartbeat", response_model=DeviceRead)
async def heartbeat(payload: DeviceHeartbeat, session: AsyncSession = Depends(get_session)) -> DeviceRead:
    try:
        device = await DeviceService(session).heartbeat(payload)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    return to_device_read(device)


@router.post("/{device_id}/test", response_model=CameraTestResponse)
async def test_saved_camera(
    device_id: str,
    _: UserRead = Depends(require_scopes(Scope.DEVICES_READ)),
    session: AsyncSession = Depends(get_session),
) -> CameraTestResponse:
    device = await session.get(CaptureDevice, device_id)
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Camera nao encontrada")
    result = await asyncio.to_thread(test_camera_connection, stored_camera_config(device))
    await DeviceService(session).update_connection_status(device_id, result.status)
    return result


@router.get("/{device_id}/snapshot")
async def camera_snapshot(
    device_id: str,
    _: UserRead = Depends(require_scopes(Scope.DEVICES_READ)),
    session: AsyncSession = Depends(get_session),
) -> Response:
    device = await session.get(CaptureDevice, device_id)
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Camera nao encontrada")
    config = stored_camera_config(device)
    try:
        image = await asyncio.to_thread(read_camera_jpeg, config)
    except Exception as exc:
        # The exception text may come from OpenCV/FFmpeg and can echo the stream URL.
        logger.warning("Falha ao capturar snapshot device_id=%s error_type=%s", device_id, type(exc).__name__)
        await DeviceService(session).update_connection_status(device_id, DeviceStatus.MAINTENANCE)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Nao foi possivel obter imagem da camera",
        ) from exc
    await DeviceService(session).update_connection_status(device_id, DeviceStatus.ACTIVE)
    return Response(content=image, media_type="image/jpeg")
