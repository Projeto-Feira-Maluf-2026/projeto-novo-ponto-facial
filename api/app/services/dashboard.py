from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import SAO_PAULO, as_local, local_day_utc_bounds
from app.models.entities import AttendanceRecord, CaptureDevice, Employee, SuspiciousAttempt, Worksite
from app.models.enums import AttendanceStatus, EmployeeStatus, PunchType
from app.schemas.dashboard import DashboardMetrics


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
        start, end = local_day_utc_bounds(datetime.now(SAO_PAULO).date())
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
        timeline_counts = {}
        # Only load columns used by the aggregates, not notes/metadata/biometric
        # scores or ORM entities for every attendance record of the day.
        records = await self.session.stream(select(
            AttendanceRecord.employee_id, AttendanceRecord.occurred_at,
            AttendanceRecord.punch_type, AttendanceRecord.status,
        ).where(*day).order_by(
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
            if record.status != AttendanceStatus.ACCEPTED:
                continue
            present_ids.add(record.employee_id)
            prior = previous.get(record.employee_id)
            seconds += completed_interval_seconds(prior, record)
            previous[record.employee_id] = record
        present = len(present_ids)
        return DashboardMetrics(
            total_employees=total, present_employees=present,
            absent_employees=max(total-present, 0), records_today=records_today,
            worked_hours_today=round(seconds/3600, 2), worksites=worksites,
            connected_devices=connected, fraud_alerts=alerts, by_worksite=by_worksite,
            timeline=[dict(hour=hour, records=count) for hour, count in sorted(timeline_counts.items())],
        )
