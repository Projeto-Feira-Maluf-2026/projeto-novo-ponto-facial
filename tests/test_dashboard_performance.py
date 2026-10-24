from datetime import datetime, timedelta

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session

from app.core.time import local_day_utc_bounds, SAO_PAULO
from app.models.entities import (
    AttendanceRecord, Base, CaptureDevice, Employee, SuspiciousAttempt, Worksite,
)
from app.models.enums import AlertSeverity, AttendanceStatus, EmployeeStatus, FraudType, PunchType
from app.services.access import ResourceAccess, install_resource_scope
from app.services.dashboard import DashboardService


class AsyncRowsAdapter:
    def __init__(self, session):
        self.session = session

    async def execute(self, statement):
        return self.session.execute(statement)

    async def stream(self, statement):
        async def rows():
            for row in self.session.execute(statement):
                yield row
        return rows()


@pytest.mark.parametrize('scoped', [False, True])
@pytest.mark.asyncio
async def test_dashboard_uses_three_scoped_queries_and_preserves_metrics(scoped):
    engine = create_engine('sqlite://')
    Base.metadata.create_all(engine)
    start, _ = local_day_utc_bounds(datetime.now(SAO_PAULO).date())
    with Session(engine) as session:
        for identity in ('a', 'b'):
            session.add(Worksite(id=identity, name=identity, code=identity, address='address'))
            session.add(Employee(id=identity, name=identity, registration=identity))
            session.add(CaptureDevice(id=identity, name=identity, worksite_id=identity,
                                      serial_number=identity, api_key_hash='test',
                                      last_seen_at=start + timedelta(hours=1)))
            session.add(SuspiciousAttempt(id=identity, worksite_id=identity,
                                         fraud_type=FraudType.UNKNOWN_FACE,
                                         severity=AlertSeverity.HIGH,
                                         created_at=start + timedelta(hours=1)))
            for index, (kind, offset, status) in enumerate([
                (PunchType.ENTRY, 4, AttendanceStatus.ACCEPTED),
                (PunchType.LUNCH_OUT, 8, AttendanceStatus.ACCEPTED),
                (PunchType.EXIT, 9, AttendanceStatus.REJECTED),
                (PunchType.LUNCH_IN, 9, AttendanceStatus.ACCEPTED),
                (PunchType.EXIT, 13, AttendanceStatus.ACCEPTED),
                (PunchType.ENTRY, 14, AttendanceStatus.MANUAL_REVIEW),
            ]):
                session.add(AttendanceRecord(id=f'{identity}-{index}', employee_id=identity,
                                             worksite_id=identity, punch_type=kind, status=status,
                                             occurred_at=start + timedelta(hours=offset)))
        session.add(Employee(id='leave', name='leave', registration='leave',
                             status=EmployeeStatus.ON_LEAVE))
        session.commit()
        if scoped:
            install_resource_scope(session, ResourceAccess(('a',), ('a',)))
        queries = []
        event.listen(engine, 'before_cursor_execute', lambda *args: queries.append(args[2]))
        metrics = await DashboardService(AsyncRowsAdapter(session)).metrics()
        multiplier = 1 if scoped else 2
        assert len(queries) == 3
        assert metrics.total_employees == multiplier
        assert metrics.present_employees == multiplier
        assert metrics.absent_employees == 0
        assert metrics.records_today == 6 * multiplier
        assert metrics.worked_hours_today == 8 * multiplier
        assert metrics.worksites == multiplier
        assert metrics.connected_devices == multiplier
        assert metrics.fraud_alerts == multiplier
        assert sum(row['records'] for row in metrics.timeline) == 6 * multiplier
        assert len(metrics.by_worksite) == multiplier
        assert metrics.by_worksite[0] == {'name': 'a', 'records': 6}
        assert not session.identity_map  # Projection does not hydrate full records.
    engine.dispose()
