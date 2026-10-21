"""The kiosk's punch endpoint (spec M2 §5.2).

Order of the checks: body size, device signature (`require_kiosk`), rate limit, then the
decision. Everything the server decides about a scan, including a refusal, comes back as a
normal 200 answer; only a broken or untrusted request is an error.
"""

import ipaddress

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.core.errors import ApiError
from app.modules.auth.rate_limit import punch_limiter
from app.modules.kiosks.dependencies import require_kiosk
from app.modules.kiosks.models import KioskDevice
from app.modules.punches import service
from app.modules.punches.schemas import KioskPunchRequest, KioskPunchResponse

router = APIRouter(tags=["punches"])


# The 64 KB body limit is enforced earlier, by BodyLimitMiddleware (app/core/body_limit.py):
# FastAPI would parse the body before any dependency of this route could refuse it.
@router.post("/punch/kiosk", response_model=KioskPunchResponse)
def punch_at_kiosk(
    body: KioskPunchRequest,
    request: Request,
    kiosk: KioskDevice = Depends(require_kiosk),
    session: Session = Depends(get_session),
) -> KioskPunchResponse:
    if not punch_limiter.allow(str(kiosk.id)):
        raise ApiError("TOO_MANY_REQUESTS", "Too many punches. Wait a moment.", 429)
    client = service.ClientInfo(ip=_ip_or_none(getattr(request.state, "client_ip", None)))
    return service.record_kiosk_punch(session, kiosk, body, client)


def _ip_or_none(text: str | None) -> str | None:
    """The address is only for logs. "unknown" or any other non-address is stored as nothing,
    so a strange proxy setup can never make a punch fail."""
    try:
        return str(ipaddress.ip_address(text or ""))
    except ValueError:
        return None
