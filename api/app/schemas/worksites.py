from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class WorksiteCreate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    code: str = Field(min_length=2, max_length=40)
    address: str = Field(min_length=5, max_length=255)
    manager_name: str | None = None
    active: bool = True


class WorksiteUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    address: str | None = Field(default=None, min_length=5, max_length=255)
    manager_name: str | None = None
    active: bool | None = None


class WorksiteRead(ORMModel):
    id: str
    name: str
    code: str
    address: str
    manager_name: str | None
    active: bool
    created_at: datetime
    updated_at: datetime
