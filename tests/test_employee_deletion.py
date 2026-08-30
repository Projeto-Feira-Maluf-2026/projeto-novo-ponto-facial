from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.entities import Employee
from app.models.enums import EmployeeStatus
from app.services.employees import EmployeeService


def employee() -> Employee:
    return Employee(
        id="employee-delete-test",
        registration="DELETE-001",
        name="Cadastro para exclusao",
        status=EmployeeStatus.ACTIVE,
    )


@pytest.mark.asyncio
async def test_permanent_delete_removes_every_employee_owned_record() -> None:
    session = MagicMock(
        get=AsyncMock(return_value=employee()),
        scalars=AsyncMock(return_value=["attendance-delete-test"]),
        execute=AsyncMock(),
        commit=AsyncMock(),
        rollback=AsyncMock(),
        add=MagicMock(),
    )

    await EmployeeService(session).delete(
        "employee-delete-test",
        actor_user_id="admin-test",
    )

    statements = [
        str(call.args[0])
        for call in session.execute.await_args_list
        if str(call.args[0]).startswith("DELETE FROM ")
    ]
    deleted_tables = {
        statement.split("DELETE FROM ", 1)[1].split(" ", 1)[0]
        for statement in statements
    }
    assert deleted_tables == {
        "attendance_records",
        "audit_logs",
        "employee_worksites",
        "employees",
        "face_enrollment_sessions",
        "face_templates",
        "suspicious_attempts",
    }
    session.commit.assert_awaited_once()
    session.rollback.assert_not_awaited()
    audit_entry = session.add.call_args.args[0]
    assert audit_entry.action == "employee.permanently_deleted"
    assert audit_entry.actor_user_id == "admin-test"
    assert audit_entry.metadata_json == {"permanent": True}


@pytest.mark.asyncio
async def test_permanent_delete_rolls_back_the_whole_transaction_on_failure() -> None:
    session = MagicMock(
        get=AsyncMock(return_value=employee()),
        scalars=AsyncMock(return_value=[]),
        execute=AsyncMock(side_effect=RuntimeError("database failure")),
        commit=AsyncMock(),
        rollback=AsyncMock(),
        add=MagicMock(),
    )

    with pytest.raises(RuntimeError, match="database failure"):
        await EmployeeService(session).delete("employee-delete-test")

    session.rollback.assert_awaited_once()
    session.commit.assert_not_awaited()
