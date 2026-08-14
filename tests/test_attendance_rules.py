from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.entities import AttendanceRecord
from app.models.enums import EmployeeStatus, PunchType
from app.schemas.attendance import PunchCreate
from app.services.attendance import (
    AttendanceService,
    attendance_confidence,
    next_punch_type,
)


def test_punch_sequence() -> None:
    assert next_punch_type(None) == PunchType.ENTRY
    assert next_punch_type(PunchType.ENTRY) == PunchType.LUNCH_OUT
    assert next_punch_type(PunchType.LUNCH_OUT) == PunchType.LUNCH_IN
    assert next_punch_type(PunchType.LUNCH_IN) == PunchType.EXIT
    assert next_punch_type(PunchType.EXIT) == PunchType.ENTRY


def test_attendance_confidence_uses_only_measured_server_signals() -> None:
    assert attendance_confidence(0.80, 0.60) == 0.75


@pytest.mark.asyncio
async def test_punch_does_not_invent_low_liveness_when_pad_is_unavailable() -> None:
    worksite = SimpleNamespace(
        id="worksite-1",
        active=True,
        latitude=None,
        longitude=None,
        geofence_radius_meters=120,
    )
    employee = SimpleNamespace(
        id="employee-1",
        name="Funcionario Teste",
        registration="CE-001",
        photo_url=None,
        status=EmployeeStatus.ACTIVE,
    )
    processed = SimpleNamespace(
        quality=SimpleNamespace(
            accepted=True,
            quality_score=0.72,
            reasons=[],
        ),
        inference=SimpleNamespace(embedding=[1.0, 0.0]),
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
        from_image_base64=MagicMock(return_value=processed),
    )
    service = AttendanceService(session, face_service)
    service._match_employee = AsyncMock(
        return_value=(employee, 0.78, None, 0.86, None)
    )
    payload = PunchCreate(
        employee_id=employee.id,
        worksite_id=worksite.id,
        punch_type=PunchType.ENTRY,
        face={
            "image_base64": "data:image/jpeg;base64,validado",
            "liveness_score": 0.0,
            "motion_score": 0.0,
            "spoof_hints": ["phone_screen"],
        },
    )

    decision = await service.register_punch(payload)

    assert decision.accepted is True
    assert decision.liveness_evaluated is False
    assert decision.liveness_score is None
    assert decision.reasons == []
    assert session.add.call_count == 1
    assert isinstance(session.add.call_args.args[0], AttendanceRecord)


@pytest.mark.asyncio
async def test_punch_preserves_and_validates_three_temporal_frames() -> None:
    worksite = SimpleNamespace(
        id="worksite-1",
        active=True,
        latitude=None,
        longitude=None,
        geofence_radius_meters=120,
    )
    employee = SimpleNamespace(
        id="employee-1",
        name="Funcionário Teste",
        registration="CE-001",
        photo_url=None,
        status=EmployeeStatus.ACTIVE,
    )
    processed = SimpleNamespace(
        quality=SimpleNamespace(accepted=True, quality_score=0.82, reasons=[]),
        inference=SimpleNamespace(embedding=[1.0, 0.0, 0.0]),
    )
    session = SimpleNamespace(
        get=AsyncMock(return_value=worksite),
        add=MagicMock(),
        commit=AsyncMock(),
        refresh=AsyncMock(),
    )

    async def refresh_record(record: AttendanceRecord) -> None:
        record.id = "record-temporal"
        record.created_at = datetime.now(UTC).replace(tzinfo=None)

    session.refresh.side_effect = refresh_record
    face_service = SimpleNamespace(
        from_image_base64=MagicMock(return_value=processed),
    )
    service = AttendanceService(session, face_service)
    service._match_employee = AsyncMock(
        return_value=(employee, 0.81, None, 0.9, None)
    )
    payload = PunchCreate(
        employee_id=employee.id,
        worksite_id=worksite.id,
        punch_type=PunchType.ENTRY,
        face={"images_base64": ["frame-1", "frame-2", "frame-3"]},
    )

    decision = await service.register_punch(payload)

    assert decision.accepted is True
    assert decision.temporal_evidence_count == 3
    assert decision.temporal_similarity_median == pytest.approx(1.0)
    assert face_service.from_image_base64.call_count == 3
