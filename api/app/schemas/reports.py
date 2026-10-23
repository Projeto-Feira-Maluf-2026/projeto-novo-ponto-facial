from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, model_validator

from app.core.config import settings
from app.core.time import as_utc_naive


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

    @model_validator(mode="after")
    def validate_period_and_scope(self) -> "ReportRequest":
        starts_at, ends_at = as_utc_naive(self.starts_at), as_utc_naive(self.ends_at)
        if ends_at < starts_at:
            raise ValueError("ends_at deve ser posterior ou igual a starts_at")
        if (ends_at - starts_at).total_seconds() > settings.REPORT_MAX_PERIOD_DAYS * 86400:
            raise ValueError("Periodo de relatorio excede o limite operacional")
        if self.kind == ReportKind.EMPLOYEE and not self.employee_id:
            raise ValueError("employee_id e obrigatorio para relatorio por funcionario")
        if self.kind == ReportKind.WORKSITE and not self.worksite_id:
            raise ValueError("worksite_id e obrigatorio para relatorio por obra")
        return self
