from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, model_validator


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
        if self.ends_at < self.starts_at:
            raise ValueError("ends_at deve ser posterior ou igual a starts_at")
        if self.kind == ReportKind.EMPLOYEE and not self.employee_id:
            raise ValueError("employee_id e obrigatorio para relatorio por funcionario")
        if self.kind == ReportKind.WORKSITE and not self.worksite_id:
            raise ValueError("worksite_id e obrigatorio para relatorio por obra")
        return self
