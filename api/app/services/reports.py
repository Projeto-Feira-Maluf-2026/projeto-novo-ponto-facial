import csv
from html import escape
from io import BytesIO, StringIO

import anyio
from openpyxl import Workbook
from openpyxl.cell import WriteOnlyCell
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import LongTable, Paragraph, SimpleDocTemplate, Spacer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import as_local, as_utc_naive
from app.core.config import settings
from app.core.errors import AppError
from app.models.entities import AttendanceRecord, Employee, Worksite
from app.schemas.reports import ReportFormat, ReportRequest


def csv_cell(value):
    """Keep exported user text from becoming a spreadsheet formula."""
    if isinstance(value, str) and (
        value.startswith(("\t", "\r", "\n"))
        or value.lstrip().startswith(("=", "+", "-", "@", "＝", "＋", "－", "＠"))
    ):
        return "'" + value
    return value


class ReportService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def export(self, payload: ReportRequest) -> tuple[bytes, str, str]:
        rows = await self._rows(payload)
        filename = f"relatorio-ponto-{payload.kind.value}.{payload.format.value}"
        if payload.format == ReportFormat.CSV:
            writer, media_type = self._csv, "text/csv"
        elif payload.format == ReportFormat.XLSX:
            writer, media_type = self._xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        else:
            writer, media_type = self._pdf, "application/pdf"
        # Blocking document formatting must not block camera/attendance requests.
        content = await anyio.to_thread.run_sync(writer, rows, limiter=report_limiter())
        return content, media_type, filename

    async def _rows(self, payload: ReportRequest) -> list[dict]:
        statement = (
            select(AttendanceRecord, Employee.name, Employee.registration, Worksite.name)
            .join(Employee, AttendanceRecord.employee_id == Employee.id)
            .join(Worksite, AttendanceRecord.worksite_id == Worksite.id)
            .where(
                AttendanceRecord.occurred_at >= as_utc_naive(payload.starts_at),
                AttendanceRecord.occurred_at <= as_utc_naive(payload.ends_at),
            )
            .order_by(AttendanceRecord.occurred_at)
            .limit(settings.REPORT_MAX_ROWS + 1)
        )
        if payload.employee_id:
            statement = statement.where(AttendanceRecord.employee_id == payload.employee_id)
        if payload.worksite_id:
            statement = statement.where(AttendanceRecord.worksite_id == payload.worksite_id)
        result = await self.session.execute(statement)
        records = result.all()
        if len(records) > settings.REPORT_MAX_ROWS:
            raise AppError("REPORT_TOO_LARGE", "Reduza o periodo ou filtre a obra/funcionario", 422)
        return [
            {
                "data_hora": as_local(record.occurred_at).strftime("%d/%m/%Y %H:%M"),
                "funcionario": employee_name,
                "matricula": registration,
                "obra": worksite_name,
                "tipo": record.punch_type.value,
                "status": record.status.value,
                "confianca": record.confidence_score,
                "latitude": record.latitude,
                "longitude": record.longitude,
            }
            for record, employee_name, registration, worksite_name in records
        ]

    def _csv(self, rows: list[dict]) -> bytes:
        output = StringIO()
        fieldnames = list(rows[0].keys()) if rows else ["data_hora", "funcionario", "matricula", "obra", "tipo", "status"]
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows({key: csv_cell(value) for key, value in row.items()} for row in rows)
        return output.getvalue().encode()

    def _xlsx(self, rows: list[dict]) -> bytes:
        output = BytesIO()
        workbook = Workbook(write_only=True)
        sheet = workbook.create_sheet("Ponto")
        fieldnames = list(rows[0].keys()) if rows else [
            "data_hora",
            "funcionario",
            "matricula",
            "obra",
            "tipo",
            "status",
        ]
        sheet.append(fieldnames)
        for row in rows:
            cells = []
            for field in fieldnames:
                value = row.get(field)
                cell = WriteOnlyCell(sheet, value=value)
                if isinstance(value, str):
                    cell.data_type = "s"
                cells.append(cell)
            sheet.append(cells)
        workbook.save(output)
        return output.getvalue()

    def _pdf(self, rows: list[dict]) -> bytes:
        output = BytesIO()
        page_size = landscape(A4)
        document = SimpleDocTemplate(output, pagesize=page_size, leftMargin=30,
                                     rightMargin=30, topMargin=36, bottomMargin=36)
        text_style = ParagraphStyle("row", fontName="Helvetica", fontSize=8,
                                    leading=11, splitLongWords=True)
        title_style = ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=15,
                                     leading=20, textColor=colors.HexColor("#23362b"))
        fields = ["data_hora", "matricula", "funcionario", "obra", "tipo", "status"]
        headers = ["Data / hora", "Matricula", "Funcionario", "Obra", "Tipo", "Status"]
        data = [[Paragraph(header, text_style) for header in headers]]
        for row in rows:
            data.append([Paragraph(escape(str(row.get(field, ""))), text_style)
                         for field in fields])
        table = LongTable(data, colWidths=[86, 86, 206, 206, 82, 115],
                          repeatRows=1, splitInRow=1, hAlign="LEFT")
        table.setStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e4eadf")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LINEBELOW", (0, 0), (-1, 0), 0.8, colors.HexColor("#57614e")),
            ("LINEBELOW", (0, 1), (-1, -1), 0.3, colors.HexColor("#d4d8d1")),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ])

        def footer(canvas, doc):
            canvas.setFont("Helvetica", 8)
            canvas.drawString(30, 20, "Horarios exibidos em America/Sao_Paulo")
            canvas.drawRightString(page_size[0] - 30, 20, f"Pagina {doc.page}")

        document.build([Paragraph("Relatorio de Ponto - Curitiba Empreiteira", title_style),
                        Spacer(1, 12), table], onFirstPage=footer, onLaterPages=footer)
        return output.getvalue()


_report_limiter = None


def report_limiter() -> anyio.CapacityLimiter:
    global _report_limiter
    if _report_limiter is None:
        _report_limiter = anyio.CapacityLimiter(2)
    return _report_limiter
