from collections import deque
from datetime import datetime, timedelta

from sqlalchemy import case, distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.sql.functions import FunctionElement
from sqlalchemy.types import String

from app.core.time import SAO_PAULO, as_local, local_day_utc_bounds, utc_isoformat
from app.models.entities import AttendanceRecord, CaptureDevice, Employee, SuspiciousAttempt, Worksite
from app.models.enums import AttendanceStatus, EmployeeStatus, PunchType
from app.schemas.dashboard import DashboardMetrics

HISTORY_DAYS = 30
RECENT_LIMIT = 15


class local_day(FunctionElement):
    """Sao Paulo calendar day (YYYY-MM-DD) of a naive-UTC column, grouped in SQL."""

    type = String()
    inherit_cache = True


@compiles(local_day, "postgresql")
def _local_day_postgresql(element, compiler, **kw):
    column = compiler.process(element.clauses, **kw)
    return f"to_char(timezone('America/Sao_Paulo', timezone('UTC', {column})), 'YYYY-MM-DD')"


@compiles(local_day)
def _local_day_default(element, compiler, **kw):
    # SQLite (tests): Sao Paulo has had a fixed UTC-3 offset since 2019.
    column = compiler.process(element.clauses, **kw)
    return f"date({column}, '-3 hours')"


def completed_interval_seconds(prior, record) -> float:
    if prior is not None and (
        (prior.punch_type == PunchType.ENTRY and record.punch_type in {PunchType.LUNCH_OUT, PunchType.EXIT})
        or (prior.punch_type == PunchType.LUNCH_IN and record.punch_type == PunchType.EXIT)
    ):
        return max(0.0, (record.occurred_at - prior.occurred_at).total_seconds())
    return 0.0


def completed_work_hours(records) -> float:
    """Count only adjacent recorded work intervals; incomplete sessions are not estimated."""
    previous = {}
    seconds = 0.0
    for record in records:
        seconds += completed_interval_seconds(previous.get(record.employee_id), record)
        previous[record.employee_id] = record
    return round(seconds / 3600, 2)


class DashboardService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def metrics(self) -> DashboardMetrics:
        today = datetime.now(SAO_PAULO).date()
        start, end = local_day_utc_bounds(today)
        history_start, _ = local_day_utc_bounds(today - timedelta(days=HISTORY_DAYS - 1))
        day = (AttendanceRecord.occurred_at >= start, AttendanceRecord.occurred_at < end)
        # ORM queries inherit the request's persisted worksite/employee authorization criteria.
        # One round trip for independent counts, without sharing an AsyncSession
        # between concurrent tasks or bypassing ORM resource scopes with raw SQL.
        total, worksites, connected, alerts = (await self.session.execute(select(
            select(func.count(Employee.id)).where(
                Employee.status == EmployeeStatus.ACTIVE
            ).scalar_subquery(),
            select(func.count(Worksite.id)).where(Worksite.active.is_(True)).scalar_subquery(),
            select(func.count(CaptureDevice.id)).where(
                CaptureDevice.last_seen_at >= start
            ).scalar_subquery(),
            select(func.count(SuspiciousAttempt.id)).where(
                SuspiciousAttempt.created_at >= start, SuspiciousAttempt.created_at < end
            ).scalar_subquery(),
        ))).one()
        by_worksite = [dict(name=name, records=count) for name, count in await self.session.execute(
            select(Worksite.name, func.count(AttendanceRecord.id))
            .outerjoin(AttendanceRecord, (AttendanceRecord.worksite_id == Worksite.id) & day[0] & day[1])
            .where(Worksite.active.is_(True)).group_by(Worksite.id, Worksite.name).order_by(Worksite.name)
        )]

        # 30-day history aggregated by the database (one row per day), served by
        # ix_attendance_occurred_cover, instead of shipping every record to Python.
        record_day = local_day(AttendanceRecord.occurred_at)
        daily_rows = await self.session.execute(
            select(
                record_day,
                func.count(AttendanceRecord.id),
                func.count(distinct(case(
                    (AttendanceRecord.status == AttendanceStatus.ACCEPTED, AttendanceRecord.employee_id),
                ))),
                func.sum(case((AttendanceRecord.status == AttendanceStatus.ACCEPTED, 1), else_=0)),
                func.sum(case((AttendanceRecord.status == AttendanceStatus.REJECTED, 1), else_=0)),
            )
            .where(AttendanceRecord.occurred_at >= history_start, AttendanceRecord.occurred_at < end)
            .group_by(record_day)
        )
        history = {
            str(key): dict(records=int(records or 0), present=int(present or 0),
                           accepted=int(accepted or 0), rejected=int(rejected or 0), alerts=0)
            for key, records, present, accepted, rejected in daily_rows
        }
        alert_day = local_day(SuspiciousAttempt.created_at)
        for key, count in await self.session.execute(
            select(alert_day, func.count(SuspiciousAttempt.id))
            .where(SuspiciousAttempt.created_at >= history_start, SuspiciousAttempt.created_at < end)
            .group_by(alert_day)
        ):
            history.setdefault(str(key), dict(records=0, present=0, accepted=0, rejected=0,
                                              alerts=0))["alerts"] = int(count or 0)

        timeline_counts = {}
        status_counts = {status.value: 0 for status in AttendanceStatus}
        recent = deque(maxlen=RECENT_LIMIT)
        # Only load columns used by the aggregates, not notes/metadata/biometric
        # scores or ORM entities for every attendance record of the day.
        records = await self.session.stream(select(
            AttendanceRecord.id, AttendanceRecord.employee_id, AttendanceRecord.occurred_at,
            AttendanceRecord.punch_type, AttendanceRecord.status,
            Employee.name.label("employee_name"), Worksite.name.label("worksite_name"),
        ).outerjoin(Employee, Employee.id == AttendanceRecord.employee_id)
         .outerjoin(Worksite, Worksite.id == AttendanceRecord.worksite_id)
         .where(*day).order_by(
            AttendanceRecord.occurred_at, AttendanceRecord.id
        ).execution_options(yield_per=500))
        previous = {}
        present_ids = set()
        records_today = 0
        seconds = 0.0
        async for record in records:
            records_today += 1
            hour = as_local(record.occurred_at).strftime("%H:00")
            timeline_counts[hour] = timeline_counts.get(hour, 0) + 1
            status_counts[str(record.status)] = status_counts.get(str(record.status), 0) + 1
            recent.append(record)
            if record.status != AttendanceStatus.ACCEPTED:
                continue
            present_ids.add(record.employee_id)
            prior = previous.get(record.employee_id)
            seconds += completed_interval_seconds(prior, record)
            previous[record.employee_id] = record
        present = len(present_ids)

        empty_day = dict(records=0, present=0, accepted=0, rejected=0, alerts=0)
        daily = []
        for offset in range(HISTORY_DAYS - 1, -1, -1):
            key = (today - timedelta(days=offset)).isoformat()
            daily.append(dict(date=key, **history.get(key, empty_day)))

        return DashboardMetrics(
            total_employees=total, present_employees=present,
            absent_employees=max(total-present, 0), records_today=records_today,
            worked_hours_today=round(seconds/3600, 2), worksites=worksites,
            connected_devices=connected, fraud_alerts=alerts, by_worksite=by_worksite,
            timeline=[dict(hour=hour, records=count) for hour, count in sorted(timeline_counts.items())],
            status_today=status_counts,
            daily=daily,
            recent=[dict(
                id=row.id, employee_name=row.employee_name or "Funcionário",
                worksite_name=row.worksite_name or "", punch_type=str(row.punch_type),
                status=str(row.status), occurred_at=utc_isoformat(row.occurred_at),
            ) for row in reversed(recent)],
        )
