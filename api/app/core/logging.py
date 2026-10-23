"""Structured logs without payloads or exception values."""
from contextvars import ContextVar
from datetime import UTC, datetime
import json
import logging
import re
import sys

request_id_context: ContextVar[str] = ContextVar("request_id", default="unknown")


def redact_message(message: str) -> str:
    message = re.sub(r"\[(?:\s*[-+0-9.eE]+\s*,){3,}[^\]]*\]", "[REDACTED_VECTOR]", message)
    message = re.sub(r"(?i)(bearer\s+)[^\s,;]+", r"\1[REDACTED]", message)
    message = re.sub(r"(?i)(password|token|secret|embedding|image_base64|authorization|email)[\"']?\s*[:=]\s*(?:\"(?:\\.|[^\"\\])*\"|'(?:\\.|[^'\\])*'|[^\s,;]+)",
                     r"\1=[REDACTED]", message)
    message = re.sub(r"[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}", "[REDACTED_EMAIL]", message)
    message = re.sub(r"[A-Za-z0-9_+/=-]{80,}", "[REDACTED_VALUE]", message)
    return message[:1000]


class JsonLogFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        from app.core.config import settings
        payload = {
            "timestamp": datetime.now(UTC).isoformat(), "level": record.levelname,
            "service": "ponto-api", "environment": settings.ENVIRONMENT,
            "logger": record.name, "request_id": request_id_context.get(),
            "message": redact_message(record.getMessage()),
        }
        for key in ("event", "method", "route", "status", "duration_ms"):
            if hasattr(record, key):
                value = getattr(record, key)
                payload[key] = redact_message(value) if isinstance(value, str) else value
        if record.exc_info and record.exc_info[0]:
            payload["exception_type"] = record.exc_info[0].__name__
        return json.dumps(payload, ensure_ascii=False)


def configure_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonLogFormatter())
    logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)
    for name in ("httpx", "httpcore", "sqlalchemy.engine"):
        logging.getLogger(name).setLevel(logging.WARNING)

