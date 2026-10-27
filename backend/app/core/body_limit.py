"""Stops oversized request bodies while they arrive, before the app has read them into memory.

FastAPI reads and parses a JSON body BEFORE it runs any route dependency, so a check inside a
dependency would come too late: someone could send hundreds of MB to the free 512 MB server and
crash it for every gate. This is a plain ASGI middleware, so it sees the bytes first. It answers
413 `PAYLOAD_TOO_LARGE` as soon as the declared length (or the count so far) passes the limit.
"""

import json
from collections.abc import Callable

from starlette.types import ASGIApp, Message, Receive, Scope, Send

KIOSK_BODY_LIMIT = 64 * 1024  # a punch is a small JSON with one 15 KB photo
# M3: a face punch carries 2-4 frames of at most 70 KB each, as base64 (spec §5.2).
FACE_PUNCH_BODY_LIMIT = 384 * 1024
CODE_TRY_BODY_LIMIT = 2 * 1024
FACE_PUNCH_PATH = "/api/v1/punch/kiosk"
CODE_TRY_PATH = "/api/v1/punch/kiosk/code"
IMPORT_BODY_LIMIT = 3 * 1024 * 1024  # the Excel import allows 2 MB, plus the form's own overhead
DEFAULT_BODY_LIMIT = 1024 * 1024  # every other JSON request

_KIOSK_PATHS = ("/api/v1/punch/", "/api/v1/kiosk/")
# One enrolment shot is a 150 KB JPEG as base64 inside JSON (spec M3 §5.4).
ENROLMENT_SHOT_LIMIT = 256 * 1024
_ENROLMENT_SESSIONS_PATH = "/api/v1/face/enrolment-sessions/"
_IMPORT_PATH_SUFFIX = "/employees/import"


def body_limit_for(path: str) -> int:
    if path == FACE_PUNCH_PATH:
        return FACE_PUNCH_BODY_LIMIT  # a card punch above 64 KB is refused by the route
    if path == CODE_TRY_PATH:
        return CODE_TRY_BODY_LIMIT
    if path.startswith(_KIOSK_PATHS):
        return KIOSK_BODY_LIMIT
    if path.startswith(_ENROLMENT_SESSIONS_PATH) and path.endswith("/shots"):
        return ENROLMENT_SHOT_LIMIT
    if path.startswith("/api/") and _IMPORT_PATH_SUFFIX in path:
        return IMPORT_BODY_LIMIT
    return DEFAULT_BODY_LIMIT


class _BodyTooLargeError(Exception):
    pass


class BodyLimitMiddleware:
    def __init__(self, app: ASGIApp, limit_for_path: Callable[[str], int] = body_limit_for) -> None:
        self.app = app
        self.limit_for_path = limit_for_path

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        limit = self.limit_for_path(scope["path"])
        declared = _declared_length(scope)
        if declared is not None and declared > limit:
            await _send_too_large(send)
            return

        received = 0
        too_large = False
        response_started = False

        async def counting_receive() -> Message:
            nonlocal received, too_large
            message = await receive()
            if message["type"] == "http.request":
                # A sender may leave out Content-Length, so the real bytes are counted.
                received += len(message.get("body", b""))
                if received > limit:
                    too_large = True
                    raise _BodyTooLargeError
            return message

        async def tracking_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, counting_receive, tracking_send)
        except BaseException:
            # Inner layers may wrap our exception (for example in an ExceptionGroup), so the
            # flag decides, not the exception type.
            if too_large and not response_started:
                await _send_too_large(send)
                return
            raise


def _declared_length(scope: Scope) -> int | None:
    for name, value in scope["headers"]:
        if name == b"content-length" and value.isdigit():
            return int(value)
    return None


async def _send_too_large(send: Send) -> None:
    body = json.dumps(
        {
            "error": {
                "code": "PAYLOAD_TOO_LARGE",
                "message": "The request is too large.",
                "details": {},
            }
        }
    ).encode()
    headers: list[tuple[bytes, bytes]] = [
        (b"content-type", b"application/json"),
        (b"content-length", str(len(body)).encode()),
        (b"cache-control", b"no-store"),
        (b"connection", b"close"),
    ]
    await send({"type": "http.response.start", "status": 413, "headers": headers})
    await send({"type": "http.response.body", "body": body})
