"""The request body limit stops a big body while it arrives (security review of M2, H1).

These tests drive the middleware directly with raw ASGI messages, because the point is to prove
that the app STOPS READING near the limit, which a normal test client cannot show.
"""

import asyncio
import json

from starlette.types import Message, Receive, Scope, Send

from app.core.body_limit import (
    CODE_TRY_BODY_LIMIT,
    DEFAULT_BODY_LIMIT,
    ENROLMENT_SHOT_LIMIT,
    FACE_PUNCH_BODY_LIMIT,
    IMPORT_BODY_LIMIT,
    KIOSK_BODY_LIMIT,
    BodyLimitMiddleware,
    body_limit_for,
)

CHUNK = 16 * 1024


class Probe:
    """A tiny app behind the middleware: it reads the whole body, then answers 200."""

    def __init__(self) -> None:
        self.bytes_read = 0
        self.answered = False

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        while True:
            message = await receive()
            self.bytes_read += len(message.get("body", b""))
            if not message.get("more_body", False):
                break
        self.answered = True
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})


def call(path: str, chunks: int, declared: int | None = None) -> tuple[int, bytes, Probe, int]:
    """Send `chunks` pieces of 16 KB. Returns status, answer body, the probe, pieces taken."""
    probe = Probe()
    sent: list[Message] = []
    taken = 0

    async def receive() -> Message:
        nonlocal taken
        taken += 1
        return {"type": "http.request", "body": b"x" * CHUNK, "more_body": taken < chunks}

    async def send(message: Message) -> None:
        sent.append(message)

    headers = [(b"content-length", str(declared).encode())] if declared is not None else []
    scope: Scope = {"type": "http", "path": path, "headers": headers}
    asyncio.run(BodyLimitMiddleware(probe)(scope, receive, send))
    status = sent[0]["status"]
    return status, sent[1]["body"], probe, taken


def test_each_kind_of_request_has_its_own_limit() -> None:
    assert body_limit_for("/api/v1/punch/kiosk") == FACE_PUNCH_BODY_LIMIT  # M3: face frames
    assert body_limit_for("/api/v1/punch/kiosk/code") == CODE_TRY_BODY_LIMIT
    assert body_limit_for("/api/v1/punch/challenge") == KIOSK_BODY_LIMIT
    assert body_limit_for("/api/v1/face/enrolment-sessions/abc/shots") == ENROLMENT_SHOT_LIMIT
    assert body_limit_for("/api/v1/face/enrolment-sessions/abc/finish") == DEFAULT_BODY_LIMIT
    assert body_limit_for("/api/v1/kiosk/report") == KIOSK_BODY_LIMIT
    assert body_limit_for("/api/v1/employees/import") == IMPORT_BODY_LIMIT
    assert body_limit_for("/api/v1/auth/login") == DEFAULT_BODY_LIMIT


def test_a_small_body_goes_through() -> None:
    status, _, probe, _ = call("/api/v1/kiosk/report", chunks=2)

    assert status == 200
    assert probe.bytes_read == 2 * CHUNK


def test_a_declared_length_over_the_limit_is_refused_without_reading_anything() -> None:
    status, body, probe, taken = call("/api/v1/kiosk/report", chunks=1, declared=500_000_000)

    assert status == 413
    assert json.loads(body)["error"] == {
        "code": "PAYLOAD_TOO_LARGE",
        "message": "The request is too large.",
        "details": {},
    }
    assert taken == 0 and not probe.answered


def test_a_body_without_a_length_is_cut_off_near_the_limit() -> None:
    # 100 pieces of 16 KB would be 1.6 MB. The kiosk limit is 64 KB = 4 pieces.
    status, body, probe, taken = call("/api/v1/kiosk/report", chunks=100)

    assert status == 413
    assert json.loads(body)["error"]["code"] == "PAYLOAD_TOO_LARGE"
    assert taken == KIOSK_BODY_LIMIT // CHUNK + 1  # it stopped reading one piece past the limit
    assert not probe.answered


def test_other_endpoints_allow_more_but_not_unlimited() -> None:
    ok_status, *_ = call("/api/v1/auth/login", chunks=10)  # 160 KB
    too_big_status, *_ = call("/api/v1/auth/login", chunks=100)  # 1.6 MB

    assert ok_status == 200
    assert too_big_status == 413
