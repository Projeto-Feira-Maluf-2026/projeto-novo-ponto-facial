from datetime import UTC, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import BackgroundTasks

from app.models.entities import AttendanceRecord
from app.models.enums import AttendanceStatus, EmployeeStatus, FraudType, PunchType
from app.schemas.attendance import (
    AttendanceCorrection,
    AttendanceDecision,
    PunchBatchCreate,
    PunchCreate,
)
from app.api.v1.routes.attendance import punch_batch
from app.services.attendance import (
    AttendanceService,
    TERMINAL_DUPLICATE_CAPTURE_WINDOW,
    attendance_confidence,
    attendance_frame_is_usable,
    next_punch_type,
)


def test_terminal_duplicate_window_is_one_minute() -> None:
    assert TERMINAL_DUPLICATE_CAPTURE_WINDOW == timedelta(minutes=1)


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
async def test_borderline_match_uses_one_mirrored_retry_and_can_recover() -> None:
    worksite = SimpleNamespace(id="worksite-1", name="Obra Teste", active=True)
    employee = SimpleNamespace(
        id="employee-1",
        name="Funcionário Teste",
        registration="CE-001",
        photo_url=None,
        email=None,
        status=EmployeeStatus.ACTIVE,
    )
    source_image = SimpleNamespace(image_bgr=None)
    original = SimpleNamespace(
        image=source_image,
        quality=SimpleNamespace(accepted=True, quality_score=0.82, reasons=[]),
        inference=SimpleNamespace(embedding=[1.0, 0.0]),
    )
    mirrored = SimpleNamespace(
        image=source_image,
        quality=SimpleNamespace(accepted=True, quality_score=0.84, reasons=[]),
        inference=SimpleNamespace(embedding=[0.98, 0.02]),
    )
    face_service = SimpleNamespace(
        from_image_base64=MagicMock(return_value=original),
        from_mirrored_image=MagicMock(return_value=mirrored),
    )
    session = SimpleNamespace(
        get=AsyncMock(return_value=worksite),
        scalar=AsyncMock(return_value=None),
        add=MagicMock(),
        commit=AsyncMock(),
        refresh=AsyncMock(),
    )

    async def refresh_record(record: AttendanceRecord) -> None:
        record.created_at = datetime.now(UTC).replace(tzinfo=None)

    session.refresh.side_effect = refresh_record
    service = AttendanceService(session, face_service)
    service._match_employee = AsyncMock(side_effect=[
        (employee, 0.56, 0.49, 0.61, "low_similarity"),
        (employee, 0.68, 0.51, 0.86, None),
    ])

    decision = await service.register_punch(PunchCreate(
        employee_id=None,
        worksite_id=worksite.id,
        punch_type=PunchType.ENTRY,
        face={"image_base64": "data:image/jpeg;base64,limiar"},
    ))

    assert decision.accepted is True
    assert decision.similarity_score == pytest.approx(0.68)
    assert decision.temporal_evidence_count == 2
    assert decision.temporal_similarity_median is not None
    face_service.from_mirrored_image.assert_called_once_with(source_image)
    assert service._match_employee.await_count == 2


@pytest.mark.asyncio
async def test_mirrored_retry_never_combines_inconsistent_identity() -> None:
    worksite = SimpleNamespace(id="worksite-1", active=True)
    source_image = SimpleNamespace(image_bgr=None)
    face_service = SimpleNamespace(
        from_image_base64=MagicMock(return_value=SimpleNamespace(
            image=source_image,
            quality=SimpleNamespace(accepted=True, quality_score=0.8, reasons=[]),
            inference=SimpleNamespace(embedding=[1.0, 0.0]),
        )),
        from_mirrored_image=MagicMock(return_value=SimpleNamespace(
            image=source_image,
            quality=SimpleNamespace(accepted=True, quality_score=0.8, reasons=[]),
            inference=SimpleNamespace(embedding=[0.0, 1.0]),
        )),
    )
    session = SimpleNamespace(
        get=AsyncMock(return_value=worksite),
        add=MagicMock(),
        commit=AsyncMock(),
    )
    service = AttendanceService(session, face_service)
    service._match_employee = AsyncMock(return_value=(
        SimpleNamespace(id="employee-1"),
        0.56,
        0.49,
        0.61,
        "low_similarity",
    ))

    decision = await service.register_punch(PunchCreate(
        employee_id=None,
        worksite_id=worksite.id,
        face={"image_base64": "data:image/jpeg;base64,limiar"},
    ))

    assert decision.accepted is False
    assert decision.reasons == ["low_similarity"]
    assert service._match_employee.await_count == 1


@pytest.mark.asyncio
async def test_terminal_duplicate_face_reuses_record_without_advancing_punch() -> None:
    now = datetime.now(UTC).replace(tzinfo=None)
    worksite = SimpleNamespace(id="worksite-1", active=True)
    employee = SimpleNamespace(
        id="employee-1",
        name="Funcionário Teste",
        registration="CE-001",
        photo_url=None,
        status=EmployeeStatus.ACTIVE,
    )
    existing = AttendanceRecord(
        id="record-existing",
        employee_id=employee.id,
        worksite_id=worksite.id,
        device_id=None,
        punch_type=PunchType.ENTRY,
        status=AttendanceStatus.ACCEPTED,
        occurred_at=now - timedelta(seconds=2),
        latitude=None,
        longitude=None,
        similarity_score=0.83,
        liveness_score=None,
        quality_score=0.79,
        confidence_score=0.88,
        offline_batch_id="terminal-scan-1",
        notes=None,
        metadata_json={},
        created_at=now,
        updated_at=now,
    )
    processed = SimpleNamespace(
        quality=SimpleNamespace(accepted=True, quality_score=0.8, reasons=[]),
        inference=SimpleNamespace(embedding=[1.0, 0.0]),
    )
    session = SimpleNamespace(
        get=AsyncMock(return_value=worksite),
        scalar=AsyncMock(return_value=existing),
        add=MagicMock(),
        commit=AsyncMock(),
        refresh=AsyncMock(),
    )
    service = AttendanceService(
        session,
        SimpleNamespace(from_image_base64=MagicMock(return_value=processed)),
    )
    service._match_employee = AsyncMock(
        return_value=(employee, 0.84, None, 0.9, None)
    )

    decision = await service.register_punch(PunchCreate(
        employee_id=None,
        worksite_id=worksite.id,
        punch_type=None,
        face={"image_base64": "data:image/jpeg;base64,duplicada"},
        offline_batch_id="terminal-scan-2",
        occurred_at=now.replace(tzinfo=UTC),
    ))

    assert decision.accepted is True
    assert decision.record is not None
    assert decision.record.id == existing.id
    assert decision.punch_type == PunchType.ENTRY
    assert decision.reasons == ["duplicate_capture"]
    session.add.assert_not_called()
    session.commit.assert_not_awaited()


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
    service = SimpleNamespace(
        register_punch=AsyncMock(side_effect=decisions),
        send_pending_email_notifications=AsyncMock(return_value={}),
        pending_email_notifications={},
    )
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

    session = SimpleNamespace(commit=AsyncMock(), rollback=AsyncMock())
    background_tasks = BackgroundTasks()

    result = await punch_batch(payload, background_tasks, SimpleNamespace(id="user-1"), session)

    # O grupo inteiro e gravado em uma unica transacao.
    session.commit.assert_awaited_once()
    assert not background_tasks.tasks
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
async def test_batch_punch_sends_email_after_responding(monkeypatch: pytest.MonkeyPatch) -> None:
    decision = AttendanceDecision(
        accepted=True,
        status=AttendanceStatus.ACCEPTED,
        employee_id="employee-1",
        punch_type=PunchType.ENTRY,
        confidence_score=0.9,
        similarity_score=0.88,
        liveness_score=None,
        quality_score=0.8,
        reasons=[],
        record={
            "id": "record-1",
            "employee_id": "employee-1",
            "worksite_id": "worksite-1",
            "device_id": None,
            "punch_type": PunchType.ENTRY,
            "status": AttendanceStatus.ACCEPTED,
            "occurred_at": datetime(2026, 10, 22, 12, 0),
            "latitude": None,
            "longitude": None,
            "similarity_score": 0.88,
            "liveness_score": None,
            "quality_score": 0.8,
            "confidence_score": 0.9,
            "offline_batch_id": None,
            "notes": None,
        },
    )
    service = SimpleNamespace(
        register_punch=AsyncMock(return_value=decision),
        send_pending_email_notifications=AsyncMock(return_value={"record-1": True}),
        pending_email_notifications={"record-1": {"recipient": "a@example.com"}},
    )
    monkeypatch.setattr(
        "app.api.v1.routes.attendance.AttendanceService",
        lambda _session, **_kwargs: service,
    )
    monkeypatch.setattr(
        "app.api.v1.routes.attendance.is_lightweight_serverless",
        lambda: False,
    )
    background_tasks = BackgroundTasks()
    result = await punch_batch(
        PunchBatchCreate(punches=[PunchCreate(
            employee_id=None,
            worksite_id="worksite-1",
            face={"image_base64": "face-1"},
        )]),
        background_tasks,
        SimpleNamespace(id="user-1"),
        SimpleNamespace(commit=AsyncMock(), rollback=AsyncMock()),
    )

    # A resposta nao espera o SMTP: o envio fica agendado para depois dela.
    service.send_pending_email_notifications.assert_not_awaited()
    assert len(background_tasks.tasks) == 1
    assert result.decisions[0].email_notification_sent is False


@pytest.mark.asyncio
async def test_repeated_unknown_face_is_logged_once_per_window() -> None:
    session = SimpleNamespace(add=MagicMock())
    service = AttendanceService(session, SimpleNamespace())
    payload = PunchCreate(
        employee_id=None,
        worksite_id="worksite-dedup",
        face={"image_base64": "frame"},
    )

    await service._flag_attempt(payload, FraudType.LOW_SIMILARITY, 0.4, ["low_similarity"])
    await service._flag_attempt(payload, FraudType.LOW_SIMILARITY, 0.4, ["low_similarity"])
    await service._flag_attempt(payload, FraudType.LOW_SIMILARITY, 0.4, ["ambiguous_face"])

    assert session.add.call_count == 2


@pytest.mark.asyncio
async def test_group_matching_reuses_templates_within_one_request() -> None:
    provider_info = SimpleNamespace(
        model_name="model",
        model_version="1",
        embedding_dimension=2,
        detector_name="detector",
        normalization_version="v1",
    )
    template = SimpleNamespace(
        id="template-1",
        employee_id="employee-1",
        embedding=b"\x00" * 8,
        quality_score=0.8,
    )
    scalars = MagicMock(return_value=[template])
    session = SimpleNamespace(
        scalars=AsyncMock(side_effect=scalars),
        get=AsyncMock(return_value=None),
    )
    face_service = SimpleNamespace(provider=SimpleNamespace(info=lambda: provider_info))
    service = AttendanceService(session, face_service)

    await service._match_employee([([1.0, 0.0], 0.8)], None, "worksite-1")
    await service._match_employee([([1.0, 0.0], 0.8)], None, "worksite-1")

    assert session.scalars.await_count == 1


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
