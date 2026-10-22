"""`require_kiosk`: endpoints a kiosk device calls with signed requests (spec §7 rule 6).

Headers: X-Kiosk-Id, X-Kiosk-Nonce, X-Kiosk-Counter, X-Kiosk-Signature. The device's clock
is never used; the counter must always grow, so a recorded request cannot be replayed.
"""

import logging
import uuid

from fastapi import Depends, Request
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.core.client_ip import get_client_ip
from app.core.db import get_session
from app.core.errors import ApiError
from app.core.time import utc_now
from app.modules.audit.service import Actor, record_audit
from app.modules.kiosks.crypto import signed_message, verify_signature
from app.modules.kiosks.models import KioskDevice, KioskStatus

logger = logging.getLogger(__name__)


def _invalid() -> ApiError:
    return ApiError("DEVICE_SIGNATURE_INVALID", "This device is not paired.", 401)


def _log_refusal(request: Request, reason: str, kiosk_id: uuid.UUID | None = None) -> None:
    """One warning line per failed device login. Only the reason, the kiosk id (if it could be
    read) and the client address are logged: never the body, signature, nonce or card text."""
    logger.warning(
        "kiosk auth refused",
        extra={
            "fields": {
                "reason": reason,
                "kiosk_id": str(kiosk_id) if kiosk_id else None,
                "client_ip": get_client_ip(request),
            }
        },
    )


def _audit_refusal(session: Session, request: Request, kiosk: KioskDevice, reason: str) -> None:
    """A paired device that is refused (revoked, or replaying a request) is worth a row the
    admin can see. Strangers only get the log line, so they cannot fill the audit log."""
    record_audit(
        session,
        actor=Actor("kiosk", kiosk.id, get_client_ip(request)),
        action="kiosk.auth_refused",
        entity_type="kiosk_device",
        entity_id=kiosk.id,
        after={"reason": reason},
        plant_id=kiosk.plant_id,
    )
    session.commit()


async def require_kiosk(request: Request, session: Session = Depends(get_session)) -> KioskDevice:
    headers = request.headers
    try:
        kiosk_id = uuid.UUID(headers.get("x-kiosk-id", ""))
        counter = int(headers.get("x-kiosk-counter", ""))
    except ValueError:
        _log_refusal(request, "DEVICE_HEADERS_INVALID")
        raise _invalid() from None
    nonce = headers.get("x-kiosk-nonce")
    signature = headers.get("x-kiosk-signature")
    if not nonce or not signature:
        _log_refusal(request, "DEVICE_HEADERS_INVALID", kiosk_id)
        raise _invalid()

    kiosk = session.get(KioskDevice, kiosk_id)
    if (
        kiosk is None
        or kiosk.public_key is None
        or kiosk.status not in (KioskStatus.ACTIVE.value, KioskStatus.REVOKED.value)
    ):
        _log_refusal(request, "DEVICE_UNKNOWN", kiosk_id)
        raise _invalid()

    path = request.url.path + (f"?{request.url.query}" if request.url.query else "")
    message = signed_message(request.method, path, await request.body(), nonce, counter)
    if not verify_signature(kiosk.public_key, message, signature):
        _log_refusal(request, "DEVICE_SIGNATURE_INVALID", kiosk_id)
        raise _invalid()
    # Only the real device can read "revoked": a stranger who knows the id learns nothing.
    if kiosk.status == KioskStatus.REVOKED.value:
        _log_refusal(request, "DEVICE_REVOKED", kiosk_id)
        _audit_refusal(session, request, kiosk, "DEVICE_REVOKED")
        raise ApiError("DEVICE_REVOKED", "This device has been switched off.", 403)

    # One statement: the counter only ever goes up, even for two requests at the same moment.
    raised = session.execute(
        update(KioskDevice)
        .where(KioskDevice.id == kiosk.id, KioskDevice.last_counter < counter)
        .values(last_counter=counter, last_seen_at=utc_now())
    )
    if raised.rowcount == 0:  # pyright: ignore[reportAttributeAccessIssue]
        session.rollback()
        _log_refusal(request, "NONCE_REUSED", kiosk_id)
        _audit_refusal(session, request, kiosk, "NONCE_REUSED")
        raise ApiError("NONCE_REUSED", "This request was already used.", 401)
    session.commit()
    request.state.client_ip = get_client_ip(request)
    return kiosk
