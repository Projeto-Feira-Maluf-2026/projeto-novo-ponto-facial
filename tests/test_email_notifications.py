from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.entities import AttendanceRecord
from app.models.enums import AttendanceStatus, EmployeeStatus, PunchType
from app.schemas.attendance import PunchCreate
from app.services.attendance import AttendanceService
from app.services.email_notifications import AttendanceEmailNotifier


def test_email_contains_real_attendance_information(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.services.email_notifications.settings.EMAIL_FROM_ADDRESS", "sender@example.com")
    notifier = AttendanceEmailNotifier()

    message = notifier._build_message(
        recipient="funcionario@example.com",
        employee_name="João da Silva",
        worksite_name="Obra Batel",
        punch_type=PunchType.ENTRY,
        occurred_at=datetime(2026, 8, 22, 10, 32, tzinfo=UTC),
        record_id="record-123",
    )

    assert message["To"] == "funcionario@example.com"
    assert message["Subject"] == "Ponto registrado — Entrada"
    assert "22/08/2026" in message.get_body(preferencelist=("plain",)).get_content()
    assert "07:32" in message.get_body(preferencelist=("plain",)).get_content()
    assert "Obra Batel" in message.get_body(preferencelist=("plain",)).get_content()


@pytest.mark.asyncio
async def test_email_failure_is_swallowed_after_point_is_saved(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.services.email_notifications.settings.EMAIL_NOTIFICATIONS_ENABLED", True)
    monkeypatch.setattr("app.services.email_notifications.settings.EMAIL_FROM_ADDRESS", "sender@example.com")
    monkeypatch.setattr("app.services.email_notifications.settings.BREVO_SMTP_LOGIN", "sender@example.com")
    monkeypatch.setattr("app.services.email_notifications.settings.BREVO_SMTP_KEY", "secret")
    notifier = AttendanceEmailNotifier()
    notifier._send_sync = MagicMock(side_effect=OSError("provider unavailable"))

    sent = await notifier.send_confirmation(
        recipient="funcionario@example.com",
        employee_name="Funcionário",
        worksite_name="Obra",
        punch_type=PunchType.EXIT,
        occurred_at=datetime.now(UTC),
        record_id="record-failure",
    )

    assert sent is False


@pytest.mark.asyncio
async def test_accepted_punch_notifies_employee_after_commit() -> None:
    worksite = SimpleNamespace(id="worksite-1", name="Obra Centro", active=True)
    employee = SimpleNamespace(
        id="employee-1",
        name="Funcionário Teste",
        registration="CE-001",
        photo_url=None,
        email="funcionario@example.com",
        status=EmployeeStatus.ACTIVE,
    )
    session = SimpleNamespace(
        get=AsyncMock(return_value=worksite),
        add=MagicMock(),
        commit=AsyncMock(),
        refresh=AsyncMock(),
    )

    async def refresh_record(record: AttendanceRecord) -> None:
        record.id = "record-1"
        record.created_at = datetime.now(UTC).replace(tzinfo=None)

    session.refresh.side_effect = refresh_record
    face_service = SimpleNamespace(
        from_image_base64=MagicMock(
            return_value=SimpleNamespace(
                quality=SimpleNamespace(accepted=True, quality_score=0.9, reasons=[]),
                inference=SimpleNamespace(embedding=[1.0, 0.0]),
            )
        )
    )
    notifier = SimpleNamespace(send_confirmation=AsyncMock(return_value=True))
    service = AttendanceService(session, face_service, notifier)
    service._match_employee = AsyncMock(return_value=(employee, 0.9, None, 0.95, None))

    decision = await service.register_punch(
        PunchCreate(
            employee_id=employee.id,
            worksite_id=worksite.id,
            punch_type=PunchType.ENTRY,
            face={"image_base64": "frame"},
        )
    )

    assert decision.status == AttendanceStatus.ACCEPTED
    assert decision.email_notification_sent is True
    session.commit.assert_awaited_once()
    notifier.send_confirmation.assert_awaited_once_with(
        recipient=employee.email,
        employee_name=employee.name,
        worksite_name=worksite.name,
        punch_type=PunchType.ENTRY,
        occurred_at=decision.record.occurred_at,
        record_id="record-1",
    )
