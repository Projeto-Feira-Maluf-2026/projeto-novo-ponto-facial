from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class WorksiteCreate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    code: str = Field(min_length=2, max_length=40)
    address: str = Field(min_length=5, max_length=255)
    manager_name: str | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    geofence_radius_meters: int = Field(default=120, ge=10, le=5000)
    active: bool = True


class WorksiteUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    address: str | None = Field(default=None, min_length=5, max_length=255)
    manager_name: str | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    geofence_radius_meters: int | None = Field(default=None, ge=10, le=5000)
    active: bool | None = None


class WorksiteRead(ORMModel):
    id: str
    name: str
    code: str
    address: str
    manager_name: str | None
    latitude: float | None
    longitude: float | None
    geofence_radius_meters: int
    active: bool
    created_at: datetime
    updated_at: datetime

