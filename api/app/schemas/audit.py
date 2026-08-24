from datetime import datetime

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
