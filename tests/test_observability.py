import asyncio
import json
import logging
import sys

import httpx
import pytest

from app.application import create_application
from app.core.config import settings
from app.core.logging import JsonLogFormatter, redact_message, request_id_context
from app.core.request_limits import RequestLimitsMiddleware
from app.core.telemetry import observe_request, prometheus_metrics


def test_json_logs_redact_payload_and_exception_values():
    token = request_id_context.set("synthetic-request")
    try:
        try:
            raise RuntimeError("database password secret exception value")
        except RuntimeError:
            record = logging.LogRecord("app", logging.ERROR, "test", 1,
                                       "password=secret email=test@example.com embedding=[0.1, 0.2, 0.3, 0.4, 0.5] Bearer secret-token",
                                       (), sys.exc_info())
        output = JsonLogFormatter().format(record)
        payload = json.loads(output)
        assert payload["exception_type"] == "RuntimeError"
        assert payload["request_id"] == "synthetic-request"
        assert "test@example.com" not in output
        assert "secret" not in output
        assert "0.5" not in output
        assert "database" not in output
    finally:
        request_id_context.reset(token)


@pytest.mark.asyncio
async def test_headers_and_metric_route_require_authentication():
    app = create_application()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://testserver") as client:
        response = await client.get("/health/live", headers={"X-Request-ID": "unsafe\tvalue"})
        denied = await client.get("/api/v1/observability/metrics")
    assert denied.status_code == 401
    assert response.headers["x-request-id"] != "unsafe\tvalue"
    assert response.headers["strict-transport-security"] == "max-age=31536000"
    assert "microphone=()" in response.headers["permissions-policy"]


def test_histogram_has_bounded_labels_without_user_paths():
    observe_request("POST", "/employees/{employee_id}", 200, 0.15)
    metrics = prometheus_metrics()
    assert 'route="/employees/{employee_id}"' in metrics
    assert 'le="+Inf"' in metrics


@pytest.mark.asyncio
async def test_content_length_and_chunked_overflows_return_413(monkeypatch):
    monkeypatch.setattr(settings, "REQUEST_MAX_BODY_BYTES", 8)
    app = create_application()
    async def chunks():
        yield b'{"x":"'
        yield b"a" * 16
        yield b'"}'
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver") as client:
        explicit = await client.post("/api/v1/ai/analyze-face", content=b"a" * 16)
        streamed = await client.post("/api/v1/ai/analyze-face", content=chunks(), headers={"content-type": "application/json"})
    assert explicit.status_code == 413
    assert streamed.status_code == 413


@pytest.mark.asyncio
async def test_request_timeout_returns_504(monkeypatch):
    monkeypatch.setattr(settings, "REQUEST_TIMEOUT_SECONDS", 0.01)
    async def slow(scope, receive, send):
        await asyncio.sleep(1)
    sent = []
    await RequestLimitsMiddleware(slow)({"type": "http", "headers": []}, None,
                                       lambda message: _append(sent, message))
    assert sent[0]["status"] == 504


async def _append(items, item):
    items.append(item)


@pytest.mark.parametrize("message", [
    "password='synthetic secret with spaces' next=value",
    '{"token": "synthetic secret with spaces"}',
    "secret='synthetic \\'secret\\' with spaces' next=value",
])
def test_quoted_sensitive_values_are_completely_redacted(message):
    output = redact_message(message)
    assert "synthetic" not in output
    assert "spaces" not in output
