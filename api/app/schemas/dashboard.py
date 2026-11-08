from pydantic import BaseModel, Field


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
    # Additive, read-only fields for the dashboard history widgets.
    status_today: dict[str, int] = Field(default_factory=dict)
    daily: list[dict] = Field(default_factory=list)
    recent: list[dict] = Field(default_factory=list)
