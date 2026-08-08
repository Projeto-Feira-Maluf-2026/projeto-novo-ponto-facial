from datetime import date, datetime, time

from sqlalchemy import distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import AttendanceRecord, CaptureDevice, Employee, SuspiciousAttempt, Worksite
from app.models.enums import AttendanceStatus, EmployeeStatus
from app.schemas.dashboard import DashboardMetrics


class DashboardService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def metrics(self) -> DashboardMetrics:
        start = datetime.combine(date.today(), time.min)
        end = datetime.combine(date.today(), time.max)
        total_employees = await self.session.scalar(
            select(func.count()).select_from(Employee).where(Employee.status == EmployeeStatus.ACTIVE)
        )
        present = await self.session.scalar(
            select(func.count(distinct(AttendanceRecord.employee_id))).where(
                AttendanceRecord.occurred_at.between(start, end),
                AttendanceRecord.status == AttendanceStatus.ACCEPTED,
            )
        )
        records_today = await self.session.scalar(
            select(func.count()).select_from(AttendanceRecord).where(AttendanceRecord.occurred_at.between(start, end))
        )
        worksites = await self.session.scalar(select(func.count()).select_from(Worksite).where(Worksite.active.is_(True)))
        connected_devices = await self.session.scalar(
            select(func.count()).select_from(CaptureDevice).where(CaptureDevice.last_seen_at >= start)
        )
        fraud_alerts = await self.session.scalar(
            select(func.count()).select_from(SuspiciousAttempt).where(SuspiciousAttempt.created_at.between(start, end))
        )

        by_worksite_rows = await self.session.execute(
            select(Worksite.name, func.count(AttendanceRecord.id))
            .join(AttendanceRecord, AttendanceRecord.worksite_id == Worksite.id, isouter=True)
            .group_by(Worksite.name)
            .order_by(Worksite.name)
        )
        by_worksite = [{"name": name, "records": count} for name, count in by_worksite_rows.all()]

        hour_bucket = func.date_trunc("hour", AttendanceRecord.occurred_at)
        timeline_rows = await self.session.execute(
            select(hour_bucket, func.count(AttendanceRecord.id))
            .where(AttendanceRecord.occurred_at.between(start, end))
            .group_by(hour_bucket)
            .order_by(hour_bucket)
        )
        timeline = [{"hour": str(hour), "records": count} for hour, count in timeline_rows.all()]

        total = int(total_employees or 0)
        present_count = int(present or 0)
        return DashboardMetrics(
            total_employees=total,
            present_employees=present_count,
            absent_employees=max(total - present_count, 0),
            records_today=int(records_today or 0),
            worked_hours_today=round(float(records_today or 0) * 2.0, 2),
            worksites=int(worksites or 0),
            connected_devices=int(connected_devices or 0),
            fraud_alerts=int(fraud_alerts or 0),
            by_worksite=by_worksite,
            timeline=timeline,
        )
