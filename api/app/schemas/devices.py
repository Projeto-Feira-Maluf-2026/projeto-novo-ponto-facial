from datetime import datetime

from pydantic import BaseModel, Field

from app.models.enums import DeviceStatus
from app.schemas.common import ORMModel


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
    serial_number: str
    api_key: str
    metadata_json: dict | None = None


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
