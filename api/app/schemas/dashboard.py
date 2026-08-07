from pydantic import BaseModel


class MetricCard(BaseModel):
    label: str
    value: int | float | str
    delta: float | None = None


class DashboardMetrics(BaseModel):
    total_employees: int
    present_employees: int
    absent_employees: int
    records_today: int
    worked_hours_today: float
    worksites: int
    connected_devices: int
    fraud_alerts: int
    by_worksite: list[dict]
    timeline: list[dict]

