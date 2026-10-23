from datetime import datetime

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import SAO_PAULO, local_day_utc_bounds
from app.models.enums import AttendanceStatus, EmployeeStatus
from app.schemas.dashboard import DashboardMetrics


class DashboardService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def metrics(self) -> DashboardMetrics:
        start, end = local_day_utc_bounds(datetime.now(SAO_PAULO).date())
        # Uma unica ida ao Supabase produz totais e series. No serverless, a
        # latencia de rede costuma custar mais que estas agregacoes pequenas.
        row = (
            await self.session.execute(
                text(
                    """
                    with worksite_counts as (
                      select w.name, count(ar.id)::int as records
                      from worksites w
                      left join attendance_records ar
                        on ar.worksite_id = w.id
                       and ar.occurred_at >= :start
                       and ar.occurred_at < :end
                      where w.active is true
                      group by w.name
                    ),
                    hour_counts as (
                      select
                        to_char(
                          date_trunc('hour', occurred_at) at time zone 'UTC'
                            at time zone 'America/Sao_Paulo',
                          'HH24:MI'
                        ) as hour,
                        count(id)::int as records
                      from attendance_records
                      where occurred_at >= :start and occurred_at < :end
                      group by date_trunc('hour', occurred_at)
                      order by date_trunc('hour', occurred_at)
                    )
                    select
                      (select count(*) from employees
                        where status::text = :employee_status)::int as total_employees,
                      (select count(distinct employee_id) from attendance_records
                        where occurred_at >= :start and occurred_at < :end
                          and status::text = :attendance_status)::int as present,
                      (select count(*) from attendance_records
                        where occurred_at >= :start and occurred_at < :end)::int as records_today,
                      (select count(*) from worksites where active is true)::int as worksites,
                      (select count(*) from capture_devices
                        where last_seen_at >= :start)::int as connected_devices,
                      (select count(*) from suspicious_attempts
                        where created_at >= :start and created_at < :end)::int as fraud_alerts,
                      coalesce((
                        select jsonb_agg(
                          jsonb_build_object('name', name, 'records', records)
                          order by name
                        ) from worksite_counts
                      ), '[]'::jsonb) as by_worksite,
                      coalesce((
                        select jsonb_agg(
                          jsonb_build_object('hour', hour, 'records', records)
                        ) from hour_counts
                      ), '[]'::jsonb) as timeline
                    """
                ),
                {
                    "start": start,
                    "end": end,
                    "employee_status": EmployeeStatus.ACTIVE.value,
                    "attendance_status": AttendanceStatus.ACCEPTED.value,
                },
            )
        ).one()
        total_employees = row.total_employees
        present = row.present
        records_today = row.records_today
        worksites = row.worksites
        connected_devices = row.connected_devices
        fraud_alerts = row.fraud_alerts
        by_worksite = list(row.by_worksite or [])
        timeline = list(row.timeline or [])

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
