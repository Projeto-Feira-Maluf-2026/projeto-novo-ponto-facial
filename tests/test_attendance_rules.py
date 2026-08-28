from datetime import UTC, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.entities import AttendanceRecord
from app.models.enums import AttendanceStatus, EmployeeStatus, PunchType
from app.schemas.attendance import (
    AttendanceCorrection,
    AttendanceDecision,
    PunchBatchCreate,
    PunchCreate,
)
from app.api.v1.routes.attendance import punch_batch
from app.services.attendance import (
    AttendanceService,
    attendance_confidence,
    attendance_frame_is_usable,
    next_punch_type,
)


def test_punch_sequence() -> None:
    assert next_punch_type(None) == PunchType.ENTRY
    assert next_punch_type(PunchType.ENTRY) == PunchType.LUNCH_OUT
    assert next_punch_type(PunchType.LUNCH_OUT) == PunchType.LUNCH_IN
    assert next_punch_type(PunchType.LUNCH_IN) == PunchType.EXIT
    assert next_punch_type(PunchType.EXIT) == PunchType.ENTRY


def test_evening_second_punch_becomes_exit_instead_of_lunch() -> None:
    evening_in_sao_paulo = datetime(2026, 8, 26, 1, 14, tzinfo=UTC)
    noon_in_sao_paulo = datetime(2026, 8, 25, 15, 0, tzinfo=UTC)

    assert next_punch_type(PunchType.ENTRY, evening_in_sao_paulo) == PunchType.EXIT
    assert next_punch_type(PunchType.ENTRY, noon_in_sao_paulo) == PunchType.LUNCH_OUT


def test_attendance_confidence_uses_only_measured_server_signals() -> None:
    assert attendance_confidence(0.80, 0.60) == 0.75


@pytest.mark.parametrize(
    "reason",
    ["IMAGE_TOO_BLURRY", "EXCESSIVE_YAW", "EXCESSIVE_PITCH", "EXCESSIVE_ROLL"],
)
def test_attendance_allows_distance_sensitive_quality_warning(reason: str) -> None:
    processed = SimpleNamespace(
        inference=SimpleNamespace(embedding=[1.0, 0.0]),
        quality=SimpleNamespace(accepted=False, reasons=[reason]),
    )

    assert attendance_frame_is_usable(processed) is True


def test_attendance_still_rejects_unsafe_quality_failure() -> None:
    processed = SimpleNamespace(
        inference=SimpleNamespace(embedding=[1.0, 0.0]),
        quality=SimpleNamespace(
            accepted=False,
            reasons=["IMAGE_TOO_BLURRY", "LOW_OVERALL_QUALITY"],
        ),
    )

    assert attendance_frame_is_usable(processed) is False


@pytest.mark.asyncio
async def test_punch_ignores_location_and_does_not_require_geofence() -> None:
    worksite = SimpleNamespace(
        id="worksite-1",
        active=True,
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
        # O terminal nao precisa mais identificar e depois reenviar a mesma foto.
        # O registro resolve a identidade diretamente com uma unica inferencia.
        employee_id=None,
        worksite_id=worksite.id,
        punch_type=PunchType.ENTRY,
        face={
            "image_base64": "data:image/jpeg;base64,validado",
            "liveness_score": 0.0,
            "motion_score": 0.0,
            "spoof_hints": ["phone_screen"],
        },
        # Compatibilidade: terminais antigos ainda podem enviar GPS. O campo
        # extra precisa ser ignorado e jamais interferir na decisão do ponto.
        location={"latitude": -23.5505, "longitude": -46.6333},
    )

    assert "location" not in payload.model_dump()

    decision = await service.register_punch(payload)

    assert decision.accepted is True
    assert face_service.from_image_base64.call_count == 1
    match_arguments = service._match_employee.await_args.args
    assert match_arguments[1] is None
    assert match_arguments[2] == worksite.id
    assert decision.liveness_evaluated is False
    assert decision.liveness_score is None
    assert decision.reasons == []
    assert session.add.call_count == 1
    assert isinstance(session.add.call_args.args[0], AttendanceRecord)
    assert session.add.call_args.args[0].latitude is None
    assert session.add.call_args.args[0].longitude is None


@pytest.mark.asyncio
async def test_punch_preserves_and_validates_three_temporal_frames() -> None:
    worksite = SimpleNamespace(
        id="worksite-1",
        active=True,
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


@pytest.mark.asyncio
async def test_batch_punch_processes_every_identified_face(monkeypatch: pytest.MonkeyPatch) -> None:
    decisions = [
        AttendanceDecision(
            accepted=True,
            status=AttendanceStatus.ACCEPTED,
            employee_id=f"employee-{index}",
            punch_type=PunchType.ENTRY,
            confidence_score=0.9,
            similarity_score=0.88,
            liveness_score=None,
            quality_score=0.8,
            reasons=[],
        )
        for index in (1, 2)
    ]
    service = SimpleNamespace(register_punch=AsyncMock(side_effect=decisions))
    monkeypatch.setattr(
        "app.api.v1.routes.attendance.AttendanceService",
        lambda _session, **_kwargs: service,
    )
    monkeypatch.setattr(
        "app.api.v1.routes.attendance.is_lightweight_serverless",
        lambda: False,
    )
    payload = PunchBatchCreate(
        punches=[
            PunchCreate(
                employee_id=None,
                worksite_id="worksite-1",
                face={"image_base64": f"face-{index}"},
            )
            for index in (1, 2)
        ]
    )

    result = await punch_batch(payload, SimpleNamespace(id="user-1"), SimpleNamespace())

    assert result.processed == 2
    assert result.accepted == 2
    assert result.manual_review == 0
    assert [decision.employee_id for decision in result.decisions] == [
        "employee-1",
        "employee-2",
    ]
    assert service.register_punch.await_count == 2
    assert all(
        call.args[0].employee_id is None
        for call in service.register_punch.await_args_list
    )


@pytest.mark.asyncio
async def test_manual_correction_preserves_before_and_after_in_audit() -> None:
    record = SimpleNamespace(
        id="record-1",
        occurred_at=datetime(2026, 8, 23, 10, 0),
        punch_type=PunchType.ENTRY,
        status=AttendanceStatus.ACCEPTED,
        notes=None,
    )
    session = SimpleNamespace(
        get=AsyncMock(return_value=record),
        add=MagicMock(),
        commit=AsyncMock(),
        refresh=AsyncMock(),
    )
    service = AttendanceService(session, actor_user_id="rh-user")
    local_timezone = timezone(timedelta(hours=-3))

    corrected = await service.correct(
        record.id,
        AttendanceCorrection(
            reason="Funcionário esqueceu de registrar a saída",
            occurred_at=datetime(2026, 8, 23, 18, 30, tzinfo=local_timezone),
            punch_type=PunchType.EXIT,
        ),
    )

    assert corrected.occurred_at == datetime(2026, 8, 23, 21, 30)
    assert corrected.punch_type == PunchType.EXIT
    assert corrected.notes == "Funcionário esqueceu de registrar a saída"
    audit_log = session.add.call_args.args[0]
    assert audit_log.action == "attendance.correct"
    assert audit_log.actor_user_id == "rh-user"
    assert audit_log.metadata_json["before"]["punch_type"] == "ENTRY"
    assert audit_log.metadata_json["after"]["punch_type"] == "EXIT"
    session.commit.assert_awaited_once()
