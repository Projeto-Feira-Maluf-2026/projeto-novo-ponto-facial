from datetime import UTC, datetime
import ipaddress
import logging
import socket
from urllib.parse import quote, urlsplit

from cryptography.fernet import InvalidToken
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import field_cipher
from app.core.errors import ConflictError, InvalidReferenceError
from app.core.security import password_hash, verify_password
from app.core.rate_limit import check_rate_limit
from app.core.time import as_utc_naive
from app.models.entities import CaptureDevice, Worksite
from app.models.enums import DeviceStatus
from app.schemas.devices import (
    CameraConfig,
    CameraTestResponse,
    DeviceCreate,
    DeviceHeartbeat,
    camera_address_blocked,
)

logger = logging.getLogger(__name__)

# Connection secrets are stored as Fernet tokens; legacy plaintext keys stay readable.
_ENCRYPTED_CAMERA_FIELDS = {"password": "password_encrypted", "rtsp_url": "rtsp_url_encrypted"}
CAMERA_OPEN_TIMEOUT_MS = 5000
CAMERA_READ_TIMEOUT_MS = 5000


class CameraConfigurationError(ValueError):
    """Stored camera configuration is missing, undecryptable or no longer allowed."""


def protect_camera_config(config: CameraConfig) -> dict:
    stored = config.model_dump()
    for plain_key, encrypted_key in _ENCRYPTED_CAMERA_FIELDS.items():
        value = stored.pop(plain_key, None)
        if value:
            stored[encrypted_key] = field_cipher.encrypt(value)
    return stored


class DeviceService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list(self, page: int = 1, size: int = 50) -> tuple[list[CaptureDevice], int]:
        total = await self.session.scalar(select(func.count()).select_from(CaptureDevice))
        result = await self.session.scalars(
            select(CaptureDevice).order_by(CaptureDevice.name, CaptureDevice.id).offset((page - 1) * size).limit(size)
        )
        return list(result), int(total or 0)

    async def create(self, payload: DeviceCreate) -> CaptureDevice:
        worksite_found = await self.session.scalar(
            select(Worksite.id).where(Worksite.id == payload.worksite_id)
        )
        if worksite_found is None:
            raise InvalidReferenceError("WORKSITE_NOT_FOUND", "Obra informada nao encontrada")
        metadata = dict(payload.metadata_json or {})
        # Camera settings only enter through the validated CameraConfig contract.
        metadata.pop("camera", None)
        if payload.camera:
            metadata["camera"] = protect_camera_config(payload.camera)
        device = CaptureDevice(
            worksite_id=payload.worksite_id,
            name=payload.name,
            serial_number=payload.serial_number,
            api_key_hash=password_hash(payload.api_key),
            status=payload.status,
            metadata_json=metadata,
        )
        self.session.add(device)
        try:
            await self.session.commit()
        except IntegrityError as exc:
            await self.session.rollback()
            raise ConflictError(
                "DEVICE_SERIAL_CONFLICT", "Ja existe um dispositivo com este numero de serie"
            ) from exc
        await self.session.refresh(device)
        return device

    async def heartbeat(self, payload: DeviceHeartbeat) -> CaptureDevice:
        device = await self.session.scalar(
            select(CaptureDevice).where(CaptureDevice.serial_number == payload.serial_number)
        )
        if not device or not verify_password(payload.api_key, device.api_key_hash):
            raise PermissionError("Dispositivo nao autorizado")
        await check_rate_limit("device:" + device.id, "heartbeat")
        device.last_seen_at = as_utc_naive(datetime.now(UTC))
        device.metadata_json = merge_heartbeat_metadata(device.metadata_json, payload.metadata_json)
        await self.session.commit()
        await self.session.refresh(device)
        return device

    async def update_connection_status(self, device_id: str, status: DeviceStatus) -> CaptureDevice:
        device = await self.session.get(CaptureDevice, device_id)
        if not device:
            raise LookupError("Camera nao encontrada")
        device.status = status
        if status == DeviceStatus.ACTIVE:
            device.last_seen_at = as_utc_naive(datetime.now(UTC))
        await self.session.commit()
        await self.session.refresh(device)
        return device


def sanitize_device_metadata(metadata: dict | None) -> dict | None:
    if not metadata:
        return None
    camera = metadata.get("camera")
    if not isinstance(camera, dict):
        return None
    safe_camera = {
        key: camera[key]
        for key in ("camera_type", "location_label", "recognition_enabled")
        if key in camera
    }
    return {"camera": safe_camera}


def merge_heartbeat_metadata(stored: dict | None, reported: dict | None) -> dict:
    """Keep server-owned camera settings; device reports live only under "heartbeat".

    A heartbeat authenticates with the device key, which is weaker than an
    administrator session, so it must never replace the camera URL the server probes.
    """
    merged = {key: value for key, value in (stored or {}).items() if key != "heartbeat"}
    if reported:
        merged["heartbeat"] = {key: value for key, value in reported.items() if key != "camera"}
    return merged


def camera_config_from_metadata(metadata: dict | None) -> CameraConfig:
    camera = metadata.get("camera") if metadata else None
    if not isinstance(camera, dict):
        return CameraConfig()
    values = {
        key: value for key, value in camera.items() if key not in _ENCRYPTED_CAMERA_FIELDS.values()
    }
    try:
        for plain_key, encrypted_key in _ENCRYPTED_CAMERA_FIELDS.items():
            if camera.get(encrypted_key):
                values[plain_key] = field_cipher.decrypt(camera[encrypted_key])
        return CameraConfig(**values)
    except (InvalidToken, ValidationError, TypeError) as exc:
        raise CameraConfigurationError("Configuracao da camera invalida") from exc


def _open_capture(cv2, source: str | int):
    """Open a stream with bounded connect/read time when the OpenCV build supports it."""
    if isinstance(source, int):
        return cv2.VideoCapture(source)
    open_timeout = getattr(cv2, "CAP_PROP_OPEN_TIMEOUT_MSEC", None)
    read_timeout = getattr(cv2, "CAP_PROP_READ_TIMEOUT_MSEC", None)
    if open_timeout is None or read_timeout is None:
        return cv2.VideoCapture(source)
    return cv2.VideoCapture(
        source,
        cv2.CAP_ANY,
        [open_timeout, CAMERA_OPEN_TIMEOUT_MS, read_timeout, CAMERA_READ_TIMEOUT_MS],
    )


def build_camera_source(config: CameraConfig) -> str | int:
    protocol = config.protocol.upper()
    if config.camera_type.upper() == "WEBCAM" or protocol == "LOCAL":
        return 0
    if config.rtsp_url:
        return config.rtsp_url
    if protocol in {"RTSP", "RTSPS"}:
        host = config.ip_address or ""
        auth = ""
        if config.username:
            auth = quote(config.username)
            if config.password:
                auth += f":{quote(config.password)}"
            auth += "@"
        port = f":{config.port}" if config.port else ""
        return f"{protocol.lower()}://{auth}{host}{port}/"
    host = config.ip_address or ""
    port = f":{config.port}" if config.port else ""
    scheme = "https" if protocol == "HTTPS" else "http"
    return f"{scheme}://{host}{port}"


def ensure_source_reaches_allowed_hosts(source: str | int) -> None:
    """Resolve the stream host right before connecting and refuse blocked addresses.

    The schema rejects literal loopback/metadata hosts, but a DNS name can still
    resolve to one (for example a wildcard DNS service pointing at 127.0.0.1).
    """
    if isinstance(source, int):
        return
    host = urlsplit(source).hostname
    if not host:
        raise CameraConfigurationError("Endereco de camera invalido")
    try:
        resolved = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except (OSError, UnicodeError) as exc:
        raise CameraConfigurationError("Nao foi possivel resolver o endereco da camera") from exc
    for *_, sockaddr in resolved:
        address = ipaddress.ip_address(str(sockaddr[0]).split("%", 1)[0])
        if camera_address_blocked(address):
            raise CameraConfigurationError("Endereco de camera nao permitido")


def describe_camera_source(source: str | int) -> str:
    if isinstance(source, int):
        return "local-camera"
    scheme = source.split("://", 1)[0].lower() if "://" in source else "remote"
    return f"{scheme}-camera"


def test_camera_connection(config: CameraConfig) -> CameraTestResponse:
    source = build_camera_source(config)
    try:
        import cv2
    except Exception:
        return CameraTestResponse(
            ok=False,
            status=DeviceStatus.MAINTENANCE,
            source=describe_camera_source(source),
            message="Runtime de camera indisponivel.",
        )

    try:
        ensure_source_reaches_allowed_hosts(source)
    except CameraConfigurationError as exc:
        return CameraTestResponse(
            ok=False,
            status=DeviceStatus.INACTIVE,
            source=describe_camera_source(source),
            message=f"{exc}.",
        )

    capture = _open_capture(cv2, source)
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
    ensure_source_reaches_allowed_hosts(source)
    capture = _open_capture(cv2, source)
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
