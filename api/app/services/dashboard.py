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
        accepted = AttendanceRecord.status == AttendanceStatus.ACCEPTED
        # ORM queries inherit the request's persisted worksite/employee authorization criteria.
        total = int(await self.session.scalar(select(func.count(Employee.id)).where(
            Employee.status == EmployeeStatus.ACTIVE
        )) or 0)
        present = int(await self.session.scalar(select(func.count(
            func.distinct(AttendanceRecord.employee_id)
        )).where(*day, accepted)) or 0)
        records_today = int(await self.session.scalar(select(func.count(AttendanceRecord.id)).where(*day)) or 0)
        worksites = int(await self.session.scalar(select(func.count(Worksite.id)).where(Worksite.active.is_(True))) or 0)
        connected = int(await self.session.scalar(select(func.count(CaptureDevice.id)).where(CaptureDevice.last_seen_at >= start)) or 0)
        alerts = int(await self.session.scalar(select(func.count(SuspiciousAttempt.id)).where(
            SuspiciousAttempt.created_at >= start, SuspiciousAttempt.created_at < end
        )) or 0)
        by_worksite = [dict(name=name, records=count) for name, count in await self.session.execute(
            select(Worksite.name, func.count(AttendanceRecord.id))
            .outerjoin(AttendanceRecord, (AttendanceRecord.worksite_id == Worksite.id) & day[0] & day[1])
            .where(Worksite.active.is_(True)).group_by(Worksite.id, Worksite.name).order_by(Worksite.name)
        )]
        timeline_counts = {}
        records = await self.session.stream_scalars(select(AttendanceRecord).where(*day).order_by(
            AttendanceRecord.occurred_at, AttendanceRecord.id
        ))
        previous = {}
        seconds = 0.0
        async for record in records:
            hour = as_local(record.occurred_at).strftime("%H:00")
            timeline_counts[hour] = timeline_counts.get(hour, 0) + 1
            if record.status != AttendanceStatus.ACCEPTED:
                continue
            prior = previous.get(record.employee_id)
            seconds += completed_interval_seconds(prior, record)
            previous[record.employee_id] = record
        return DashboardMetrics(
            total_employees=total, present_employees=present,
            absent_employees=max(total-present, 0), records_today=records_today,
            worked_hours_today=round(seconds/3600, 2), worksites=worksites,
            connected_devices=connected, fraud_alerts=alerts, by_worksite=by_worksite,
            timeline=[dict(hour=hour, records=count) for hour, count in sorted(timeline_counts.items())],
        )
