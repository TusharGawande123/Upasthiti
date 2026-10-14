"""`require_kiosk`: endpoints a kiosk device calls with signed requests (spec §7 rule 6).

Headers: X-Kiosk-Id, X-Kiosk-Nonce, X-Kiosk-Counter, X-Kiosk-Signature. The device's clock
is never used; the counter must always grow, so a recorded request cannot be replayed.
"""

import uuid

from fastapi import Depends, Request
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.core.client_ip import get_client_ip
from app.core.db import get_session
from app.core.errors import ApiError
from app.core.time import utc_now
from app.modules.kiosks.crypto import signed_message, verify_signature
from app.modules.kiosks.models import KioskDevice, KioskStatus


def _invalid() -> ApiError:
    return ApiError("DEVICE_SIGNATURE_INVALID", "This device is not paired.", 401)


async def require_kiosk(request: Request, session: Session = Depends(get_session)) -> KioskDevice:
    headers = request.headers
    try:
        kiosk_id = uuid.UUID(headers.get("x-kiosk-id", ""))
        counter = int(headers.get("x-kiosk-counter", ""))
    except ValueError:
        raise _invalid() from None
    nonce = headers.get("x-kiosk-nonce")
    signature = headers.get("x-kiosk-signature")
    if not nonce or not signature:
        raise _invalid()

    kiosk = session.get(KioskDevice, kiosk_id)
    if kiosk is None or kiosk.public_key is None:
        raise _invalid()
    if kiosk.status not in (KioskStatus.ACTIVE.value, KioskStatus.REVOKED.value):
        raise _invalid()

    path = request.url.path + (f"?{request.url.query}" if request.url.query else "")
    message = signed_message(request.method, path, await request.body(), nonce, counter)
    if not verify_signature(kiosk.public_key, message, signature):
        raise _invalid()
    # Only the real device can read "revoked": a stranger who knows the id learns nothing.
    if kiosk.status == KioskStatus.REVOKED.value:
        raise ApiError("DEVICE_REVOKED", "This device has been switched off.", 403)

    # One statement: the counter only ever goes up, even for two requests at the same moment.
    raised = session.execute(
        update(KioskDevice)
        .where(KioskDevice.id == kiosk.id, KioskDevice.last_counter < counter)
        .values(last_counter=counter, last_seen_at=utc_now())
    )
    if raised.rowcount == 0:  # pyright: ignore[reportAttributeAccessIssue]
        session.rollback()
        raise ApiError("NONCE_REUSED", "This request was already used.", 401)
    session.commit()
    request.state.client_ip = get_client_ip(request)
    return kiosk
