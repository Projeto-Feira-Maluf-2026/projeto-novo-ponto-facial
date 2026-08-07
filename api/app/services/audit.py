from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import AuditLog


async def audit(
    session: AsyncSession,
    action: str,
    *,
    actor_user_id: str | None = None,
    entity: str | None = None,
    entity_id: str | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
    metadata: dict | None = None,
) -> None:
    session.add(
        AuditLog(
            actor_user_id=actor_user_id,
            action=action,
            entity=entity,
            entity_id=entity_id,
            ip_address=ip_address,
            user_agent=user_agent,
            metadata_json=metadata,
        )
    )

