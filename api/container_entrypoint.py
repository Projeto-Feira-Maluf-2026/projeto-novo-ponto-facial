"""Fail-safe entrypoint for the Vercel container runtime."""

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def _port() -> int:
    try:
        return int(os.getenv("PORT", "80"))
    except ValueError:
        return 80


def _serve_startup_error(code: str, details: dict[str, object]) -> None:
    payload = json.dumps(
        {
            "error": {
                "code": code,
                "message": "O container facial nao conseguiu inicializar",
                "details": details,
            }
        }
    ).encode("utf-8")

    class StartupErrorHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            self.send_response(503)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, format: str, *args: object) -> None:
            return

    ThreadingHTTPServer(("0.0.0.0", _port()), StartupErrorHandler).serve_forever()


def main() -> None:
    minimum_lengths = {
        "DATABASE_URL": 1,
        "SUPABASE_URL": 1,
        "SUPABASE_PUBLISHABLE_KEY": 1,
        "PASSWORD_PEPPER": 32,
        "FIELD_ENCRYPTION_KEY": 44,
    }
    invalid = [
        key
        for key, minimum in minimum_lengths.items()
        if len(os.getenv(key, "")) < minimum
    ]
    if invalid:
        _serve_startup_error("MISSING_RUNTIME_ENV", {"variables": sorted(invalid)})
        return

    try:
        import uvicorn

        from app.application import create_application

        application = create_application()
    except Exception as exc:
        module = getattr(exc, "name", None)
        _serve_startup_error(
            "APP_STARTUP_FAILED",
            {
                "exception_type": type(exc).__name__,
                "module": module if isinstance(module, str) else None,
            },
        )
        return

    uvicorn.run(
        application,
        host="0.0.0.0",
        port=_port(),
        proxy_headers=True,
        forwarded_allow_ips="*",
    )


if __name__ == "__main__":
    main()
