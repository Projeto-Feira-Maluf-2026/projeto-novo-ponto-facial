"""Bound ASGI request bodies, including chunked requests without Content-Length."""
import asyncio

from starlette.responses import JSONResponse
from app.core.config import settings


class PayloadLimitExceeded(Exception):
    pass


class RequestLimitsMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        limit = settings.REQUEST_MAX_BODY_BYTES
        for key, value in scope.get("headers", []):
            if key.lower() == b"content-length":
                try:
                    length = int(value)
                    if length < 0:
                        raise ValueError
                except ValueError:
                    return await JSONResponse({"error": {"code": "INVALID_CONTENT_LENGTH"}}, 400)(scope, receive, send)
                if length > limit:
                    return await JSONResponse({"error": {"code": "PAYLOAD_TOO_LARGE"}}, 413)(scope, receive, send)
        total = 0
        started = False
        exceeded = False

        async def limited_receive():
            nonlocal total, exceeded
            message = await receive()
            if message["type"] == "http.request":
                total += len(message.get("body", b""))
                if total > limit:
                    exceeded = True
                    raise PayloadLimitExceeded
            return message

        async def tracked_send(message):
            nonlocal started
            if exceeded:
                raise PayloadLimitExceeded
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            async with asyncio.timeout(settings.REQUEST_TIMEOUT_SECONDS):
                await self.app(scope, limited_receive, tracked_send)
        except (PayloadLimitExceeded, TimeoutError) as exc:
            if started:
                raise
            status = 413 if isinstance(exc, PayloadLimitExceeded) else 504
            code = "PAYLOAD_TOO_LARGE" if status == 413 else "REQUEST_TIMEOUT"
            await JSONResponse({"error": {"code": code}}, status)(scope, receive, send)
