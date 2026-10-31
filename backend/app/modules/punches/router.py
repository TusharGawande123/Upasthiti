"""The kiosk's punch endpoints (spec M2 §5.2, M3 §5.1 and §5.2).

Order of the checks: body size, device signature (`require_kiosk`), rate limit, then the
decision. Everything the server decides about a scan or a face, including a refusal, comes back
as a normal 200 answer; only a broken or untrusted request is an error.
"""

import ipaddress
import logging
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from sqlalchemy.orm import Session

from app.core.body_limit import KIOSK_BODY_LIMIT
from app.core.db import get_session
from app.core.errors import ApiError
from app.core.time import utc_now
from app.face.engine import FaceEngine
from app.modules.auth.rate_limit import (
    RateLimiter,
    challenge_limiter,
    code_try_limiter,
    punch_limiter,
    sync_limiter,
)
from app.modules.face.engine_provider import get_face_engine
from app.modules.kiosks.dependencies import require_kiosk
from app.modules.kiosks.models import KioskDevice
from app.modules.kiosks.time_anchor import anchor_for_request
from app.modules.punches import early_out_service, face_service, service, sync_service
from app.modules.punches.photo_check import SessionMaker, check_face_in_photo, get_task_sessions
from app.modules.punches.schemas import (
    ChallengeRequest,
    ChallengeResponse,
    CodeTryRequest,
    EarlyOutConfirmRequest,
    KioskPunchRequest,
    KioskPunchResponse,
)
from app.modules.punches.sync_schemas import SyncRequest, SyncResponse

router = APIRouter(tags=["punches"])
logger = logging.getLogger(__name__)


# The body limits (384 KB face punch, 2 KB code try) are enforced earlier, by
# BodyLimitMiddleware (app/core/body_limit.py): FastAPI would parse the body before any
# dependency of this route could refuse it.
@router.post("/punch/kiosk", response_model=KioskPunchResponse)
def punch_at_kiosk(
    body: KioskPunchRequest,
    request: Request,
    background: BackgroundTasks,
    kiosk: KioskDevice = Depends(require_kiosk),
    session: Session = Depends(get_session),
    engine: FaceEngine = Depends(get_face_engine),
    task_sessions: SessionMaker = Depends(get_task_sessions),
) -> KioskPunchResponse:
    _limit(punch_limiter, kiosk, "Too many punches. Wait a moment.")
    client = service.ClientInfo(ip=_ip_or_none(getattr(request.state, "client_ip", None)))
    if body.method == "qr":
        # A card punch is a small JSON with one 15 KB photo; the M2 limit stays (spec M3 §5.2).
        if int(request.headers.get("content-length") or 0) > KIOSK_BODY_LIMIT:
            raise ApiError("PAYLOAD_TOO_LARGE", "The request is too large.", 413)

        def check_photo_later(snapshot_id: uuid.UUID, jpeg: bytes) -> None:
            # F-30, after the answer is sent: never slows the gate or changes the decision.
            background.add_task(check_face_in_photo, snapshot_id, jpeg, engine, task_sessions)

        answer = service.record_kiosk_punch(
            session, kiosk, body, client, after_photo=check_photo_later
        )
    else:
        answer = face_service.record_face_punch(session, kiosk, body, client, engine)
    return _with_anchor(answer, request, kiosk)


@router.post("/kiosk/sync", response_model=SyncResponse)
def sync_offline_punches(
    body: SyncRequest,
    request: Request,
    kiosk: KioskDevice = Depends(require_kiosk),
    session: Session = Depends(get_session),
    engine: FaceEngine = Depends(get_face_engine),
) -> SyncResponse:
    """Punches the gate saved while offline (M4 spec §5.2). Every item is decided here."""
    _limit(sync_limiter, kiosk, "Too many sync requests. Wait a moment.")
    client = service.ClientInfo(ip=_ip_or_none(getattr(request.state, "client_ip", None)))
    counter = int(getattr(request.state, "kiosk_counter", 0))
    results = sync_service.sync_items(session, kiosk, body, counter, client, engine)
    now = utc_now()
    return SyncResponse(
        results=results,
        server_time=now,
        time_anchor=anchor_for_request(request, kiosk.id, now),
    )


@router.post("/punch/challenge", response_model=ChallengeResponse)
def punch_challenge(
    body: ChallengeRequest,
    request: Request,
    kiosk: KioskDevice = Depends(require_kiosk),
    session: Session = Depends(get_session),
    engine: FaceEngine = Depends(get_face_engine),
) -> ChallengeResponse:
    """The head turn for one face punch (spec M3 §5.1). The server chooses it, never the device."""
    _limit(challenge_limiter, kiosk, "Too many face punches. Wait a moment.")
    answer = face_service.issue_challenge(session, kiosk, engine)
    answer.time_anchor = anchor_for_request(request, kiosk.id, utc_now())
    return answer


@router.post("/punch/kiosk/early-out/confirm", response_model=KioskPunchResponse)
def confirm_early_out(
    body: EarlyOutConfirmRequest,
    request: Request,
    kiosk: KioskDevice = Depends(require_kiosk),
    session: Session = Depends(get_session),
) -> KioskPunchResponse:
    """Agree at the early-OUT alert (decision 0036 line 9): the OUT is stored now."""
    _limit(punch_limiter, kiosk, "Too many punches. Wait a moment.")
    client = service.ClientInfo(ip=_ip_or_none(getattr(request.state, "client_ip", None)))
    answer = early_out_service.confirm_early_out(session, kiosk, body, client)
    return _with_anchor(answer, request, kiosk)


@router.post("/punch/kiosk/code", response_model=KioskPunchResponse)
def punch_code_try(
    body: CodeTryRequest,
    request: Request,
    kiosk: KioskDevice = Depends(require_kiosk),
    session: Session = Depends(get_session),
) -> KioskPunchResponse:
    """The typed employee code after a "needs code" answer (spec M3 §7 rule 7)."""
    _limit(code_try_limiter, kiosk, "Too many tries. Wait a moment.")
    client = service.ClientInfo(ip=_ip_or_none(getattr(request.state, "client_ip", None)))
    return _with_anchor(face_service.record_code_try(session, kiosk, body, client), request, kiosk)


def _with_anchor(
    answer: KioskPunchResponse, request: Request, kiosk: KioskDevice
) -> KioskPunchResponse:
    """Every signed answer refreshes the gate's time anchor (M4 §7 rule 8)."""
    answer.time_anchor = anchor_for_request(request, kiosk.id, utc_now())
    return answer


def _limit(limiter: RateLimiter, kiosk: KioskDevice, message: str) -> None:
    if not limiter.allow(str(kiosk.id)):
        logger.warning(
            "kiosk punch refused",
            extra={"fields": {"kiosk_id": str(kiosk.id), "reason": "TOO_MANY_REQUESTS"}},
        )
        raise ApiError("TOO_MANY_REQUESTS", message, 429)


def _ip_or_none(text: str | None) -> str | None:
    """The address is only for logs. "unknown" or any other non-address is stored as nothing,
    so a strange proxy setup can never make a punch fail."""
    try:
        return str(ipaddress.ip_address(text or ""))
    except ValueError:
        return None
