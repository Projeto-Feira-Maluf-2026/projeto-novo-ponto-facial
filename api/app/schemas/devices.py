from datetime import datetime
import ipaddress
import json
import re
import socket
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, field_validator

from app.models.enums import DeviceStatus
from app.schemas.common import ORMModel

CAMERA_PROTOCOLS = {"LOCAL", "RTSP", "RTSPS", "HTTP", "HTTPS", "ONVIF"}
CAMERA_URL_SCHEMES = {"rtsp", "rtsps", "http", "https"}
# OpenCV also accepts file paths, image sequences and GStreamer pipelines. Only a
# plain network host is accepted here, never a path, credential or pipeline token.
_HOST_PATTERN = re.compile(r"^[A-Za-z0-9.\-]{1,253}$|^\[?[0-9A-Fa-f:.]{2,45}\]?$")
_BLOCKED_HOSTNAMES = {"localhost", "metadata", "metadata.google.internal"}
HEARTBEAT_METADATA_MAX_BYTES = 4096


def _blank_to_none(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


_THIS_NETWORK = ipaddress.ip_network("0.0.0.0/8")
# AWS publishes its instance metadata on this IPv6 ULA; other ULAs stay allowed.
_BLOCKED_ADDRESSES = {ipaddress.ip_address("fd00:ec2::254")}


def camera_address_blocked(address: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """True for addresses that reach the API host itself or cloud metadata services."""
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        address = address.ipv4_mapped
    return (
        address.is_loopback
        or address.is_link_local
        or address.is_unspecified
        or address.is_multicast
        or address in _BLOCKED_ADDRESSES
        or (isinstance(address, ipaddress.IPv4Address) and address in _THIS_NETWORK)
    )


def _is_legacy_ipv4_notation(host: str) -> bool:
    """inet_aton also accepts 127.1, 2130706433, 0x7f000001 and octal forms.

    FFmpeg/libc resolve those to an IPv4 address, so they must not be treated as
    hostnames that skip the address checks.
    """
    try:
        socket.inet_aton(host)
    except OSError:
        return False
    return True


def ensure_camera_host_allowed(host: str) -> str:
    """Reject hosts that turn a camera probe into access to the API host or cloud metadata.

    Private LAN ranges stay allowed on purpose: IP cameras normally live there.
    Names are checked again after DNS resolution, right before the connection.
    """
    normalized = host.strip().strip("[]").lower()
    if not normalized or normalized in _BLOCKED_HOSTNAMES or normalized.endswith(".localhost"):
        raise ValueError("Endereco de camera nao permitido")
    try:
        address = ipaddress.ip_address(normalized)
    except ValueError:
        if _is_legacy_ipv4_notation(normalized):
            raise ValueError("Informe o IP da camera no formato 192.168.0.10") from None
        return host.strip()
    if camera_address_blocked(address):
        raise ValueError("Endereco de camera nao permitido")
    return host.strip()


class CameraConfig(BaseModel):
    camera_type: str = Field(default="WEBCAM", max_length=40)
    protocol: str = Field(default="LOCAL", max_length=20)
    ip_address: str | None = Field(default=None, max_length=120)
    port: int | None = Field(default=None, ge=1, le=65535)
    username: str | None = Field(default=None, max_length=120)
    password: str | None = Field(default=None, max_length=160)
    rtsp_url: str | None = Field(default=None, max_length=500)
    location_label: str | None = Field(default=None, max_length=160)
    recognition_enabled: bool = True
    developer_debug: bool = False

    @field_validator("camera_type", "protocol")
    @classmethod
    def normalize_upper(cls, value: str) -> str:
        return value.strip().upper()

    @field_validator("protocol")
    @classmethod
    def validate_protocol(cls, value: str) -> str:
        if value not in CAMERA_PROTOCOLS:
            raise ValueError("Protocolo de camera nao suportado")
        return value

    @field_validator("ip_address", "username", "password", "location_label", mode="before")
    @classmethod
    def strip_optional_text(cls, value):
        return _blank_to_none(value) if isinstance(value, str) else value

    @field_validator("ip_address")
    @classmethod
    def validate_host(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not _HOST_PATTERN.match(value):
            raise ValueError("Informe somente o IP ou nome do host da camera")
        return ensure_camera_host_allowed(value)

    @field_validator("rtsp_url", mode="before")
    @classmethod
    def validate_stream_url(cls, value):
        value = _blank_to_none(value) if isinstance(value, str) else value
        if value is None:
            return None
        if any(character.isspace() or ord(character) < 32 for character in value):
            raise ValueError("URL da camera invalida")
        parts = urlsplit(value)
        if parts.scheme.lower() not in CAMERA_URL_SCHEMES or not parts.hostname:
            raise ValueError("URL da camera deve usar rtsp, rtsps, http ou https")
        ensure_camera_host_allowed(parts.hostname)
        return value


class DeviceCreate(BaseModel):
    worksite_id: str
    name: str = Field(min_length=2, max_length=120)
    serial_number: str = Field(min_length=3, max_length=120)
    api_key: str = Field(min_length=32, max_length=128)
    status: DeviceStatus = DeviceStatus.ACTIVE
    camera: CameraConfig | None = None
    metadata_json: dict | None = None


class DeviceRead(ORMModel):
    id: str
    worksite_id: str
    name: str
    serial_number: str
    status: DeviceStatus
    last_seen_at: datetime | None
    metadata_json: dict | None
    created_at: datetime
    updated_at: datetime


class DeviceHeartbeat(BaseModel):
    serial_number: str = Field(min_length=1, max_length=120)
    api_key: str = Field(min_length=1, max_length=128)
    metadata_json: dict | None = None

    @field_validator("metadata_json")
    @classmethod
    def limit_metadata(cls, value: dict | None) -> dict | None:
        if value is None:
            return None
        if len(json.dumps(value, default=str)) > HEARTBEAT_METADATA_MAX_BYTES:
            raise ValueError("Metadados do heartbeat excedem o limite")
        return value


class CameraTestRequest(BaseModel):
    camera: CameraConfig


class CameraTestResponse(BaseModel):
    ok: bool
    status: DeviceStatus
    source: str
    width: int | None = None
    height: int | None = None
    fps: float | None = None
    message: str
