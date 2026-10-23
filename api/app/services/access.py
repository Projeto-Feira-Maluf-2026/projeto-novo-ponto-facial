"""Request-local resource authorization, backed by persisted grants, never user metadata."""
from dataclasses import dataclass
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import event, or_, select
from sqlalchemy.orm import with_loader_criteria

from app.models.entities import (
    AttendanceRecord, CaptureDevice, Employee, EmployeeWorksite, FaceEnrollmentSession,
    FaceTemplate, SuspiciousAttempt, UserEmployeeLink, UserWorksiteGrant, Worksite,
)
from app.models.enums import UserRole


@dataclass(frozen=True)
class ResourceAccess:
    worksite_ids: tuple[str, ...]
    employee_ids: tuple[str, ...]
    own_employee_id: str | None = None


def scope_statement(statement, access: ResourceAccess):
    """Apply the same constraints to entities, aliases, joins, counts and relationship loads."""
    options = [with_loader_criteria(Worksite, Worksite.id.in_(access.worksite_ids),
                                    include_aliases=True),
               with_loader_criteria(Employee, Employee.id.in_(access.employee_ids),
                                    include_aliases=True)]
    for model in (AttendanceRecord, CaptureDevice, EmployeeWorksite, SuspiciousAttempt):
        options.append(with_loader_criteria(
            model, model.worksite_id.in_(access.worksite_ids), include_aliases=True
        ))
    for model in (AttendanceRecord, EmployeeWorksite,
                  FaceTemplate, FaceEnrollmentSession):
        options.append(with_loader_criteria(
            model, model.employee_id.in_(access.employee_ids), include_aliases=True
        ))
    options.append(with_loader_criteria(
        SuspiciousAttempt,
        or_(SuspiciousAttempt.employee_id.is_(None),
            SuspiciousAttempt.employee_id.in_(access.employee_ids)),
        include_aliases=True,
    ))
    return statement.options(*options)


def install_resource_scope(session, access: ResourceAccess) -> None:
    sync_session = session.sync_session if hasattr(session, "sync_session") else session
    if sync_session.info.get("resource_access") is not None:
        return
    # No objects loaded before authorization may escape the criteria via the identity map.
    sync_session.expunge_all()
    sync_session.info["resource_access"] = access

    def authorize_statement(state):
        if not state.is_orm_statement:
            raise HTTPException(403, "Consulta sem escopo de recurso nao permitida")
        # Bulk DML bypasses before_flush and can assign foreign destination IDs even
        # when its target WHERE is scoped. Restricted requests must use checked objects.
        if not state.is_select:
            raise HTTPException(403, "Mutacao em lote sem validacao de recurso nao permitida")
        state.statement = scope_statement(state.statement, access)

    def authorize_flush(current, flush_context, instances):
        for item in current.new | current.dirty | current.deleted:
            if isinstance(item, Worksite) and item.id not in access.worksite_ids:
                raise HTTPException(403, "Obra fora do escopo autorizado")
            if isinstance(item, Employee) and item.id not in access.employee_ids:
                raise HTTPException(403, "Funcionario fora do escopo autorizado")
            if isinstance(item, (AttendanceRecord, CaptureDevice, EmployeeWorksite,
                                 SuspiciousAttempt)):
                if item.worksite_id not in access.worksite_ids:
                    raise HTTPException(403, "Obra fora do escopo autorizado")
            if isinstance(item, (AttendanceRecord, FaceTemplate, FaceEnrollmentSession,
                                 EmployeeWorksite)):
                if item.employee_id not in access.employee_ids:
                    raise HTTPException(403, "Funcionario fora do escopo autorizado")
            if isinstance(item, SuspiciousAttempt):
                if item.employee_id is not None and item.employee_id not in access.employee_ids:
                    raise HTTPException(403, "Funcionario fora do escopo autorizado")

    event.listen(sync_session, "do_orm_execute", authorize_statement)
    event.listen(sync_session, "before_flush", authorize_flush)


async def authorize_resources(session, user) -> ResourceAccess | None:
    # These are the existing organization-wide administrative roles. No tenant is inferred.
    if user.role in {UserRole.SUPER_ADMIN, UserRole.RH}:
        return None
    now = datetime.now(UTC).replace(tzinfo=None)
    assignment = select(EmployeeWorksite).where(
        EmployeeWorksite.active.is_(True),
        or_(EmployeeWorksite.starts_at.is_(None), EmployeeWorksite.starts_at <= now),
        or_(EmployeeWorksite.ends_at.is_(None), EmployeeWorksite.ends_at >= now),
    )
    own_id = None
    if user.role == UserRole.FUNCIONARIO:
        own_id = await session.scalar(select(UserEmployeeLink.employee_id).where(
            UserEmployeeLink.user_id == user.id, UserEmployeeLink.active.is_(True)
        ))
        if not own_id:
            raise HTTPException(403, "Sessao sem vinculo de funcionario autorizado")
        assignments = list(await session.scalars(assignment.where(
            EmployeeWorksite.employee_id == own_id
        )))
        worksite_ids = tuple(sorted({item.worksite_id for item in assignments}))
        employee_ids = (own_id,)
    else:
        worksite_ids = tuple(await session.scalars(select(UserWorksiteGrant.worksite_id).where(
            UserWorksiteGrant.user_id == user.id, UserWorksiteGrant.active.is_(True)
        )))
        employee_ids = tuple(sorted({item.employee_id for item in await session.scalars(
            assignment.where(EmployeeWorksite.worksite_id.in_(worksite_ids))
        )}))
    if not worksite_ids:
        raise HTTPException(403, "Sessao sem obras autorizadas")
    access = ResourceAccess(worksite_ids, employee_ids, own_id)
    install_resource_scope(session, access)
    return access
