from datetime import datetime

from app.models.enums import AttendanceStatus, PunchType
from app.schemas.attendance import AttendanceRead
from app.schemas.audit import AuditLogRead


def test_attendance_datetime_is_serialized_as_utc() -> None:
    record = AttendanceRead(
        id="record-1",
        employee_id="employee-1",
        worksite_id="worksite-1",
        device_id=None,
        punch_type=PunchType.EXIT,
        status=AttendanceStatus.ACCEPTED,
        occurred_at=datetime(2026, 8, 26, 1, 14),
        latitude=None,
        longitude=None,
        similarity_score=0.9,
        liveness_score=None,
        quality_score=0.8,
        confidence_score=0.9,
        offline_batch_id=None,
        notes=None,
    )

    assert '"occurred_at":"2026-08-26T01:14:00Z"' in record.model_dump_json()


def test_audit_datetime_is_serialized_as_utc() -> None:
    log = AuditLogRead(
        id="audit-1",
        actor_user_id="user-1",
        action="attendance.punch",
        entity="attendance_record",
        entity_id="record-1",
        ip_address=None,
        user_agent=None,
        metadata_json=None,
        created_at=datetime(2026, 8, 26, 1, 14),
    )

    assert '"created_at":"2026-08-26T01:14:00Z"' in log.model_dump_json()
