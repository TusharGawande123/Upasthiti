"""JSON logging with a request ID on every line.

Each request gets an ID (from the X-Request-ID header, or a new one). The same ID is sent
back in the response and written on every log line of that request, so one failed punch can
be traced through the logs on Render.
"""

import json
import logging
import re
import time
import uuid
from collections.abc import Awaitable, Callable
from contextvars import ContextVar

from fastapi import FastAPI, Request, Response

REQUEST_ID_HEADER = "X-Request-ID"

# Only short, plain IDs from clients are accepted, so nobody can inject fake log lines.
SAFE_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")

current_request_id: ContextVar[str | None] = ContextVar("current_request_id", default=None)

request_logger = logging.getLogger("app.request")


class JsonFormatter(logging.Formatter):
    """Writes each log record as one JSON object per line."""

    # Log times are in UTC, like everything else on the server.
    converter = time.gmtime

    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "time": self.formatTime(record, "%Y-%m-%dT%H:%M:%SZ"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": current_request_id.get(),
        }
        extra_fields = getattr(record, "fields", None)
        if isinstance(extra_fields, dict):
            entry.update(extra_fields)
        if record.exc_info:
            entry["error"] = self.formatException(record.exc_info)
        return json.dumps(entry, default=str)


def setup_logging(level: str) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root_logger = logging.getLogger()
    root_logger.handlers = [handler]
    root_logger.setLevel(level)


def choose_request_id(incoming: str | None) -> str:
    if incoming and SAFE_REQUEST_ID.match(incoming):
        return incoming
    return uuid.uuid4().hex


def add_request_id_middleware(app: FastAPI) -> None:
    @app.middleware("http")
    async def request_id_middleware(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        request_id = choose_request_id(request.headers.get(REQUEST_ID_HEADER))
        request.state.request_id = request_id
        current_request_id.set(request_id)
        started = time.perf_counter()

        response = await call_next(request)

        response.headers[REQUEST_ID_HEADER] = request_id
        duration_ms = round((time.perf_counter() - started) * 1000, 1)
        request_logger.info(
            "request finished",
            extra={
                "fields": {
                    "method": request.method,
                    "path": request.url.path,
                    "status": response.status_code,
                    "duration_ms": duration_ms,
                }
            },
        )
        return response
