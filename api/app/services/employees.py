from __future__ import annotations

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import field_cipher
from app.models.entities import (
    AttendanceRecord,
    AuditLog,
    Employee,
    EmployeeWorksite,
    FaceEnrollmentSession,
    FaceTemplate,
    SuspiciousAttempt,
)
from app.schemas.employees import EmployeeCreate, EmployeeUpdate
from app.services.audit import audit


class EmployeeService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list(self, search: str | None = None, page: int = 1, size: int = 50) -> tuple[list[Employee], int]:
        statement = select(Employee)
        if search:
            like = f"%{search}%"
            statement = statement.where(or_(Employee.name.ilike(like), Employee.registration.ilike(like)))
        count_statement = select(func.count()).select_from(statement.subquery())
        total = await self.session.scalar(count_statement)
        result = await self.session.scalars(statement.order_by(Employee.name).offset((page - 1) * size).limit(size))
        return list(result), int(total or 0)

    async def create(self, payload: EmployeeCreate) -> Employee:
        employee = Employee(
            registration=payload.registration,
            name=payload.name,
            document_encrypted=field_cipher.encrypt(payload.document),
            phone_encrypted=field_cipher.encrypt(payload.phone),
            email=payload.email,
            department_id=payload.department_id,
            job_role_id=payload.job_role_id,
            status=payload.status,
        )
        self.session.add(employee)
        await self.session.flush()
        await self._replace_worksites(employee.id, payload.worksite_ids)
        await self.session.commit()
        await self.session.refresh(employee)
        return employee

    async def update(self, employee_id: str, payload: EmployeeUpdate) -> Employee:
        employee = await self.session.get(Employee, employee_id)
        if not employee:
            raise LookupError("Funcionario nao encontrado")
        values = payload.model_dump(exclude_unset=True)
        worksite_ids = values.pop("worksite_ids", None)
        if "document" in values:
            employee.document_encrypted = field_cipher.encrypt(values.pop("document"))
        if "phone" in values:
            employee.phone_encrypted = field_cipher.encrypt(values.pop("phone"))
        for field, value in values.items():
            setattr(employee, field, value)
        if worksite_ids is not None:
            await self._replace_worksites(employee.id, worksite_ids)
        await self.session.commit()
        await self.session.refresh(employee)
        return employee

    async def delete(self, employee_id: str, *, actor_user_id: str | None = None) -> None:
        employee = await self.session.get(Employee, employee_id)
        if not employee:
            raise LookupError("Funcionario nao encontrado")
        try:
            attendance_ids = list(
                await self.session.scalars(
                    select(AttendanceRecord.id).where(
                        AttendanceRecord.employee_id == employee_id
                    )
                )
            )
            if attendance_ids:
                await self.session.execute(
                    delete(AuditLog).where(
                        AuditLog.entity == "attendance_record",
                        AuditLog.entity_id.in_(attendance_ids),
                    )
                )
            await self.session.execute(
                delete(AuditLog).where(
                    AuditLog.entity == "employee",
                    AuditLog.entity_id == employee_id,
                )
            )
            await self.session.execute(
                delete(FaceTemplate).where(FaceTemplate.employee_id == employee_id)
            )
            await self.session.execute(
                delete(FaceEnrollmentSession).where(
                    FaceEnrollmentSession.employee_id == employee_id
                )
            )
            await self.session.execute(
                delete(AttendanceRecord).where(AttendanceRecord.employee_id == employee_id)
            )
            await self.session.execute(
                delete(SuspiciousAttempt).where(SuspiciousAttempt.employee_id == employee_id)
            )
            await self.session.execute(
                delete(EmployeeWorksite).where(EmployeeWorksite.employee_id == employee_id)
            )
            await audit(
                self.session,
                "employee.permanently_deleted",
                actor_user_id=actor_user_id,
                entity="employee",
                entity_id=employee_id,
                metadata={"permanent": True},
            )
            await self.session.execute(delete(Employee).where(Employee.id == employee_id))
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise

    async def _replace_worksites(self, employee_id: str, worksite_ids: list[str]) -> None:
        await self.session.execute(delete(EmployeeWorksite).where(EmployeeWorksite.employee_id == employee_id))
        for worksite_id in worksite_ids:
            self.session.add(EmployeeWorksite(employee_id=employee_id, worksite_id=worksite_id))
        await self.session.flush()
