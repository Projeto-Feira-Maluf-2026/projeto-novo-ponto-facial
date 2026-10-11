from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from cryptography.fernet import InvalidToken
from fastapi import HTTPException
import pytest
from sqlalchemy import create_engine, delete, func, insert, select, text, update
from sqlalchemy.orm import Session

from app.core.crypto import EncryptedEmbedding
from app.models.entities import (
    AttendanceRecord, Base, Employee, EmployeeWorksite, FaceTemplate, SuspiciousAttempt, UserEmployeeLink,
    UserWorksiteGrant, Worksite,
)
from app.models.enums import AlertSeverity, AttendanceStatus, FraudType, PunchType, UserRole
from app.services.access import ResourceAccess, authorize_resources, install_resource_scope
from app.services.dashboard import completed_work_hours


@pytest.fixture
def session():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        for identifier in ("a", "b"):
            session.add(Worksite(id=identifier, name=identifier, code=identifier, address="address"))
            session.add(Employee(id=identifier, name=identifier, registration=identifier))
            session.add(EmployeeWorksite(employee_id=identifier, worksite_id=identifier))
            session.add(AttendanceRecord(id=identifier, employee_id=identifier,
                                         worksite_id=identifier, status=AttendanceStatus.ACCEPTED,
                                         punch_type=PunchType.ENTRY))
        session.commit()
        yield session
    engine.dispose()


def test_scope_filters_list_count_join_subquery_and_primary_key(session):
    install_resource_scope(session, ResourceAccess(("a",), ("a",)))
    assert [employee.id for employee in session.scalars(select(Employee))] == ["a"]
    assert session.scalar(select(func.count(Employee.id))) == 1
    assert session.scalar(select(func.count()).select_from(select(Employee).subquery())) == 1
    assert session.get(AttendanceRecord, "b") is None
    assert list(session.execute(select(AttendanceRecord.id, Worksite.name).join(Worksite))) == [("a", "a")]


def test_scoped_queries_cannot_fall_back_to_raw_sql(session):
    install_resource_scope(session, ResourceAccess(("a",), ("a",)))
    with pytest.raises(HTTPException, match="Consulta sem escopo"):
        session.execute(text("select * from employees"))


def test_flush_blocks_new_attendance_or_reassignment_outside_scope(session):
    install_resource_scope(session, ResourceAccess(("a",), ("a",)))
    record = session.get(AttendanceRecord, "a")
    record.worksite_id = "b"
    with pytest.raises(HTTPException, match="Obra fora"):
        session.flush()


def test_unknown_identity_alert_is_visible_only_within_authorized_worksite(session):
    for worksite_id in ("a", "b"):
        session.add(SuspiciousAttempt(id="unknown-" + worksite_id, worksite_id=worksite_id,
                                     employee_id=None, fraud_type=FraudType.UNKNOWN_FACE,
                                     severity=AlertSeverity.HIGH))
    session.commit()
    install_resource_scope(session, ResourceAccess(("a",), ("a",)))
    assert [item.id for item in session.scalars(select(SuspiciousAttempt))] == ["unknown-a"]
    session.add(SuspiciousAttempt(id="new-unknown", worksite_id="a", employee_id=None,
                                 fraud_type=FraudType.UNKNOWN_FACE, severity=AlertSeverity.HIGH))
    session.flush()
    assert session.scalar(select(func.count(SuspiciousAttempt.id))) == 2


@pytest.mark.parametrize("existing", [False, True])
def test_suspicious_attempt_cannot_reference_foreign_employee(session, existing):
    if existing:
        session.add(SuspiciousAttempt(id="alert", worksite_id="a", employee_id="a",
                                     fraud_type=FraudType.UNKNOWN_FACE, severity=AlertSeverity.HIGH))
        session.commit()
    install_resource_scope(session, ResourceAccess(("a",), ("a",)))
    if existing:
        attempt = session.get(SuspiciousAttempt, "alert")
        attempt.employee_id = "b"
    else:
        session.add(SuspiciousAttempt(worksite_id="a", employee_id="b",
                                     fraud_type=FraudType.UNKNOWN_FACE, severity=AlertSeverity.HIGH))
    with pytest.raises(HTTPException, match="Funcionario fora"):
        session.flush()


@pytest.mark.parametrize("statement", [
    update(AttendanceRecord).values(worksite_id="b"),
    update(Employee).where(Employee.id == "b").values(name="forbidden"),
    delete(AttendanceRecord),
    insert(AttendanceRecord).values(employee_id="b", worksite_id="b"),
])
def test_scoped_bulk_dml_is_rejected_before_execution(session, statement):
    install_resource_scope(session, ResourceAccess(("a",), ("a",)))
    with pytest.raises(HTTPException, match="Mutacao em lote"):
        session.execute(statement)
    assert session.get(AttendanceRecord, "a").worksite_id == "a"


class AsyncAdapter:
    def __init__(self, session):
        self.sync_session = session

    async def scalar(self, statement):
        return self.sync_session.scalar(statement)

    async def scalars(self, statement):
        return self.sync_session.scalars(statement)


@pytest.mark.asyncio
async def test_manager_uses_persisted_grants_and_denies_without_grant(session):
    user = SimpleNamespace(id="manager", role=UserRole.GESTOR_OBRA)
    with pytest.raises(HTTPException, match="Sessao sem obras"):
        await authorize_resources(AsyncAdapter(session), user)
    session.add(UserWorksiteGrant(user_id=user.id, worksite_id="a"))
    session.commit()
    access = await authorize_resources(AsyncAdapter(session), user)
    assert access.worksite_ids == ("a",)
    assert access.employee_ids == ("a",)
    assert session.get(Employee, "b") is None


@pytest.mark.asyncio
async def test_employee_has_only_linked_identity_even_when_other_employees_share_worksite(session):
    session.add(UserEmployeeLink(user_id="employee-user", employee_id="a"))
    session.add(EmployeeWorksite(employee_id="b", worksite_id="a"))
    session.commit()
    access = await authorize_resources(AsyncAdapter(session), SimpleNamespace(
        id="employee-user", role=UserRole.FUNCIONARIO
    ))
    assert access.own_employee_id == "a"
    assert [item.id for item in session.scalars(select(Employee))] == ["a"]
    assert [item.id for item in session.scalars(select(AttendanceRecord))] == ["a"]


@pytest.mark.asyncio
async def test_expired_employee_assignment_is_not_authorized(session):
    session.add(UserEmployeeLink(user_id="employee-user", employee_id="a"))
    assignment = session.scalar(select(EmployeeWorksite).where(EmployeeWorksite.employee_id == "a"))
    assignment.ends_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=1)
    session.commit()
    with pytest.raises(HTTPException, match="Sessao sem obras"):
        await authorize_resources(AsyncAdapter(session), SimpleNamespace(
            id="employee-user", role=UserRole.FUNCIONARIO
        ))


def test_embedding_cipher_roundtrip_legacy_and_authenticated_failure():
    cipher = EncryptedEmbedding()
    raw = b"biometric-vector"
    encrypted = cipher.process_bind_param(raw, None)
    assert raw not in encrypted
    assert encrypted.startswith(cipher.prefix)
    assert cipher.process_result_value(encrypted, None) == raw
    assert cipher.process_result_value(raw, None) == raw
    with pytest.raises(InvalidToken):
        cipher.process_result_value(encrypted[:-1] + b"!", None)


def test_orm_persists_ciphertext_and_matching_receives_plain_bytes(session):
    raw = b"biometric-template-bytes"
    session.add(FaceTemplate(
        id="template", employee_id="a", embedding=raw, model_name="test",
        model_version="test", embedding_dimension=512, detector_name="test",
        normalization_version="test", image_sha256="0" * 64,
        quality_score=.9, quality_metrics={}, collected_at=datetime.now(UTC).replace(tzinfo=None),
    ))
    session.commit()
    stored = session.execute(text("select embedding from face_templates where id='template'")).scalar_one()
    assert bytes(stored).startswith(EncryptedEmbedding.prefix)
    assert raw not in bytes(stored)
    session.expunge_all()
    assert session.get(FaceTemplate, "template").embedding == raw


@pytest.mark.parametrize("environment", ["staging", "production"])
def test_legacy_plaintext_is_blocked_outside_development(monkeypatch, environment):
    from app.core.config import settings
    monkeypatch.setattr(settings, "ENVIRONMENT", environment)
    with pytest.raises(ValueError, match="Legacy biometric storage"):
        EncryptedEmbedding().process_result_value(b"legacy", None)


def test_complete_work_intervals_exclude_lunch_and_open_sessions():
    start = datetime(2026, 10, 10, 11)
    records = [SimpleNamespace(employee_id="a", punch_type=kind, occurred_at=start+timedelta(hours=offset))
               for kind, offset in [(PunchType.ENTRY, 0), (PunchType.LUNCH_OUT, 4),
                                    (PunchType.LUNCH_IN, 5), (PunchType.EXIT, 9),
                                    (PunchType.ENTRY, 10)]]
    assert completed_work_hours(records) == 8
