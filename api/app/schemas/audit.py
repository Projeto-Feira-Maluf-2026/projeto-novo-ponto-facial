from datetime import datetime

from pydantic import field_serializer

from app.core.time import utc_isoformat
from app.schemas.common import ORMModel


class AuditLogRead(ORMModel):
    id: str
    actor_user_id: str | None
    action: str
    entity: str | None
    entity_id: str | None
    ip_address: str | None
    user_agent: str | None
    metadata_json: dict | None
    created_at: datetime

    @field_serializer("created_at", when_used="json")
    def serialize_created_at(self, value: datetime) -> str:
        return utc_isoformat(value)
