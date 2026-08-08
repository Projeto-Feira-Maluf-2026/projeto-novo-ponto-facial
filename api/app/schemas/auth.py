from datetime import datetime

from pydantic import BaseModel, EmailStr

from app.models.enums import UserRole


class UserRead(BaseModel):
    id: str
    name: str
    email: EmailStr
    role: UserRole
    active: bool
    scopes: list[str]
    created_at: datetime
