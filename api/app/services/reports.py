import csv
from io import BytesIO, StringIO

import pandas as pd
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import AttendanceRecord, Employee, Worksite
from app.schemas.reports import ReportFormat, ReportRequest


class ReportService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def export(self, payload: ReportRequest) -> tuple[bytes, str, str]:
        rows = await self._rows(payload)
        filename = f"relatorio-ponto-{payload.kind.value}.{payload.format.value}"
        if payload.format == ReportFormat.CSV:
            return self._csv(rows), "text/csv", filename
        if payload.format == ReportFormat.XLSX:
            return self._xlsx(rows), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename
        return self._pdf(rows), "application/pdf", filename

    async def _rows(self, payload: ReportRequest) -> list[dict]:
        statement = (
            select(AttendanceRecord, Employee.name, Employee.registration, Worksite.name)
            .join(Employee, AttendanceRecord.employee_id == Employee.id)
            .join(Worksite, AttendanceRecord.worksite_id == Worksite.id)
            .where(
                AttendanceRecord.occurred_at >= payload.starts_at.replace(tzinfo=None),
                AttendanceRecord.occurred_at <= payload.ends_at.replace(tzinfo=None),
            )
            .order_by(AttendanceRecord.occurred_at)
        )
        if payload.employee_id:
            statement = statement.where(AttendanceRecord.employee_id == payload.employee_id)
        if payload.worksite_id:
            statement = statement.where(AttendanceRecord.worksite_id == payload.worksite_id)
        result = await self.session.execute(statement)
        return [
            {
                "data_hora": record.occurred_at.isoformat(sep=" ", timespec="minutes"),
                "funcionario": employee_name,
                "matricula": registration,
                "obra": worksite_name,
                "tipo": record.punch_type.value,
                "status": record.status.value,
                "confianca": record.confidence_score,
                "latitude": record.latitude,
                "longitude": record.longitude,
            }
            for record, employee_name, registration, worksite_name in result.all()
        ]

    def _csv(self, rows: list[dict]) -> bytes:
        output = StringIO()
        fieldnames = list(rows[0].keys()) if rows else ["data_hora", "funcionario", "matricula", "obra", "tipo", "status"]
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
        return output.getvalue().encode()

    def _xlsx(self, rows: list[dict]) -> bytes:
        output = BytesIO()
        pd.DataFrame(rows).to_excel(output, index=False)
        return output.getvalue()

    def _pdf(self, rows: list[dict]) -> bytes:
        output = BytesIO()
        pdf = canvas.Canvas(output, pagesize=A4)
        width, height = A4
        pdf.setFont("Helvetica-Bold", 14)
        pdf.drawString(40, height - 50, "Relatorio de Ponto - Curitiba Empreiteira")
        pdf.setFont("Helvetica", 8)
        y = height - 80
        for row in rows[:200]:
            line = f"{row['data_hora']} | {row['matricula']} | {row['funcionario']} | {row['obra']} | {row['tipo']} | {row['status']}"
            pdf.drawString(40, y, line[:140])
            y -= 14
            if y < 40:
                pdf.showPage()
                pdf.setFont("Helvetica", 8)
                y = height - 40
        pdf.save()
        return output.getvalue()

