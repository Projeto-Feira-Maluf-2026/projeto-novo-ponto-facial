from datetime import datetime
from urllib.parse import quote

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import password_hash, verify_password
from app.models.entities import CaptureDevice
from app.models.enums import DeviceStatus
from app.schemas.devices import CameraConfig, CameraTestResponse, DeviceCreate, DeviceHeartbeat


class DeviceService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list(self, page: int = 1, size: int = 50) -> tuple[list[CaptureDevice], int]:
        total = await self.session.scalar(select(func.count()).select_from(CaptureDevice))
        result = await self.session.scalars(
            select(CaptureDevice).order_by(CaptureDevice.name).offset((page - 1) * size).limit(size)
        )
        return list(result), int(total or 0)

    async def create(self, payload: DeviceCreate) -> CaptureDevice:
        metadata = dict(payload.metadata_json or {})
        if payload.camera:
            metadata["camera"] = payload.camera.model_dump()
        device = CaptureDevice(
            worksite_id=payload.worksite_id,
            name=payload.name,
            serial_number=payload.serial_number,
            api_key_hash=password_hash(payload.api_key),
            status=payload.status,
            metadata_json=metadata,
        )
        self.session.add(device)
        await self.session.commit()
        await self.session.refresh(device)
        return device

    async def heartbeat(self, payload: DeviceHeartbeat) -> CaptureDevice:
        device = await self.session.scalar(
            select(CaptureDevice).where(CaptureDevice.serial_number == payload.serial_number)
        )
        if not device or not verify_password(payload.api_key, device.api_key_hash):
            raise PermissionError("Dispositivo nao autorizado")
        device.last_seen_at = datetime.utcnow()
        device.metadata_json = payload.metadata_json
        await self.session.commit()
        await self.session.refresh(device)
        return device

    async def update_connection_status(self, device_id: str, status: DeviceStatus) -> CaptureDevice:
        device = await self.session.get(CaptureDevice, device_id)
        if not device:
            raise LookupError("Camera nao encontrada")
        device.status = status
        if status == DeviceStatus.ACTIVE:
            device.last_seen_at = datetime.utcnow()
        await self.session.commit()
        await self.session.refresh(device)
        return device


def sanitize_device_metadata(metadata: dict | None) -> dict | None:
    if not metadata:
        return metadata
    safe = dict(metadata)
    camera = safe.get("camera")
    if isinstance(camera, dict):
        safe_camera = dict(camera)
        if safe_camera.get("password"):
            safe_camera["password"] = "********"
        safe["camera"] = safe_camera
    return safe


def camera_config_from_metadata(metadata: dict | None) -> CameraConfig:
    camera = metadata.get("camera") if metadata else None
    if isinstance(camera, dict):
        return CameraConfig(**camera)
    return CameraConfig()


def build_camera_source(config: CameraConfig) -> str | int:
    protocol = config.protocol.upper()
    if config.camera_type.upper() == "WEBCAM" or protocol == "LOCAL":
        return 0
    if config.rtsp_url:
        return config.rtsp_url
    if protocol == "RTSP":
        host = config.ip_address or ""
        auth = ""
        if config.username:
            auth = quote(config.username)
            if config.password:
                auth += f":{quote(config.password)}"
            auth += "@"
        port = f":{config.port}" if config.port else ""
        return f"rtsp://{auth}{host}{port}/"
    host = config.ip_address or ""
    port = f":{config.port}" if config.port else ""
    scheme = "https" if protocol == "HTTPS" else "http"
    return f"{scheme}://{host}{port}"


def describe_camera_source(source: str | int) -> str:
    if isinstance(source, int):
        return f"webcam:{source}"
    if "@" not in source:
        return source
    scheme, rest = source.split("://", 1) if "://" in source else ("", source)
    _, host = rest.split("@", 1)
    return f"{scheme}://***:***@{host}" if scheme else f"***:***@{host}"


def test_camera_connection(config: CameraConfig) -> CameraTestResponse:
    source = build_camera_source(config)
    try:
        import cv2
    except Exception as exc:
        return CameraTestResponse(
            ok=False,
            status=DeviceStatus.MAINTENANCE,
            source=describe_camera_source(source),
            message=f"OpenCV indisponivel: {exc}",
        )

    capture = cv2.VideoCapture(source)
    if not capture.isOpened():
        capture.release()
        return CameraTestResponse(
            ok=False,
            status=DeviceStatus.INACTIVE,
            source=describe_camera_source(source),
            message="Nao foi possivel abrir o stream da camera.",
        )

    ok, frame = capture.read()
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0) or None
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0) or None
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 0) or None
    capture.release()
    if not ok or frame is None:
        return CameraTestResponse(
            ok=False,
            status=DeviceStatus.MAINTENANCE,
            source=describe_camera_source(source),
            width=width,
            height=height,
            fps=fps,
            message="Camera abriu, mas nao retornou imagem.",
        )
    return CameraTestResponse(
        ok=True,
        status=DeviceStatus.ACTIVE,
        source=describe_camera_source(source),
        width=width,
        height=height,
        fps=fps,
        message="Camera conectada.",
    )


def read_camera_jpeg(config: CameraConfig) -> bytes:
    import cv2

    source = build_camera_source(config)
    capture = cv2.VideoCapture(source)
    if not capture.isOpened():
        capture.release()
        raise ConnectionError("Nao foi possivel abrir o stream da camera")
    ok, frame = capture.read()
    capture.release()
    if not ok or frame is None:
        raise ConnectionError("Camera nao retornou imagem")
    ok, encoded = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 88])
    if not ok:
        raise ValueError("Nao foi possivel codificar o frame")
    return encoded.tobytes()
