from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel


class ReportFormat(StrEnum):
    PDF = "pdf"
    XLSX = "xlsx"
    CSV = "csv"


class ReportKind(StrEnum):
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    EMPLOYEE = "employee"
    WORKSITE = "worksite"
    CUSTOM = "custom"


class ReportRequest(BaseModel):
    kind: ReportKind
    format: ReportFormat
    starts_at: datetime
    ends_at: datetime
    employee_id: str | None = None
    worksite_id: str | None = None

