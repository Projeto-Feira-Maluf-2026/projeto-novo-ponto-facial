import csv
from io import BytesIO, StringIO
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, Mock
import threading

from openpyxl import load_workbook
import pytest
from pypdf import PdfReader
from pydantic import ValidationError

from app.services.reports import ReportService
from app.schemas.reports import ReportRequest
from app.core.config import settings
from app.core.errors import AppError


@pytest.mark.parametrize("payload", [
    '=HYPERLINK("https://example.com", "abrir")',
    "+SUM(1,1)", "-SUM(1,1)", "@SUM(1,1)", "  =1+1", "\t=1+1", "\r=1+1",
])
def test_spreadsheet_exports_do_not_execute_user_text(payload) -> None:
    rows = [{"funcionario": payload, "confianca": 0.83}]
    service = ReportService(None)

    exported_csv = list(csv.DictReader(StringIO(service._csv(rows).decode())))[0]
    assert exported_csv["funcionario"] == "'" + payload
    assert exported_csv["confianca"] == "0.83"

    workbook = load_workbook(BytesIO(service._xlsx(rows)), data_only=False)
    sheet = workbook["Ponto"]
    # XML normalizes carriage returns when the workbook is read back.
    assert sheet["A2"].value == payload.replace("\r", "\n")
    assert sheet["A2"].data_type == "s"
    assert sheet["B2"].value == 0.83
    workbook.close()


def test_pdf_export_preserves_all_records_and_long_text() -> None:
    rows = [{
        "data_hora": "10/10/2026 08:00", "matricula": f"EMP-{index:04}",
        "funcionario": "Nome & sobrenome <literal> " * 8 + "FIM_DO_NOME", "obra": "Obra", "tipo": "ENTRY", "status": "ACCEPTED",
    } for index in range(250)]
    reader = PdfReader(BytesIO(ReportService(None)._pdf(rows)))
    rendered = "\n".join(page.extract_text() for page in reader.pages)
    assert "EMP-0249" in rendered
    assert rendered.count("EMP-") == 250
    assert rendered.count("FIM_DO_NOME") == 250
    assert "<literal>" in rendered
    assert len(reader.pages) > 1


def test_report_period_has_operational_limit() -> None:
    start = datetime(2026, 1, 1, tzinfo=UTC)
    with pytest.raises(ValidationError, match="limite operacional"):
        ReportRequest(kind="custom", format="csv", starts_at=start,
                      ends_at=start + timedelta(days=settings.REPORT_MAX_PERIOD_DAYS + 1))


@pytest.mark.asyncio
async def test_report_does_not_silently_truncate_rows(monkeypatch) -> None:
    monkeypatch.setattr(settings, "REPORT_MAX_ROWS", 2)
    session = Mock(execute=AsyncMock(return_value=Mock(all=Mock(return_value=[1, 2, 3]))))
    payload = ReportRequest(kind="custom", format="csv", starts_at="2026-10-10T00:00:00Z",
                            ends_at="2026-10-11T00:00:00Z")
    with pytest.raises(AppError) as captured:
        await ReportService(session).export(payload)
    assert captured.value.code == "REPORT_TOO_LARGE"


@pytest.mark.asyncio
async def test_formatting_runs_outside_event_loop(monkeypatch) -> None:
    main_thread = threading.get_ident()
    service = ReportService(None)
    monkeypatch.setattr(service, "_rows", AsyncMock(return_value=[]))
    observed = []
    monkeypatch.setattr(service, "_csv", lambda _: observed.append(threading.get_ident()) or b"ok")
    payload = ReportRequest(kind="custom", format="csv", starts_at="2026-10-10T00:00:00Z",
                            ends_at="2026-10-11T00:00:00Z")
    assert (await service.export(payload))[0] == b"ok"
    assert observed[0] != main_thread
