"""The server's time, handed to the gate device in a form only the server can make (M4 §7 rule 8).

Every signed kiosk answer carries `time_anchor = {server_time, counter, token}`. The token is an
HMAC over "kiosk id | server time in ms | request counter", with a key derived from
APP_SECRET_KEY. While offline the device counts the time passed since its last anchor with a
monotonic clock; at sync the server checks the token and works the punch time out itself, so
changing the device's clock changes nothing. Changing APP_SECRET_KEY only makes the anchors of
waiting punches unproven (they are flagged), never lost.
"""

import hashlib
import hmac
import uuid
from datetime import UTC, datetime

from fastapi import Request
from pydantic import BaseModel

from app.core.config import get_settings
from app.core.offline_crypto import b64url_encode

ANCHOR_LABEL = b"offline-time-anchor-v1"


class TimeAnchor(BaseModel):
    server_time: datetime
    counter: int  # the signed request's counter: offline items must come after it
    token: str


def _anchor_key() -> bytes:
    secret = get_settings().app_secret_key.encode()
    return hmac.new(secret, ANCHOR_LABEL, hashlib.sha256).digest()


def _token(kiosk_id: uuid.UUID, server_time: datetime, counter: int) -> str:
    milliseconds = int(server_time.timestamp() * 1000)
    message = f"{kiosk_id}|{milliseconds}|{counter}".encode()
    return b64url_encode(hmac.new(_anchor_key(), message, hashlib.sha256).digest())


def make_anchor(kiosk_id: uuid.UUID, server_time: datetime, counter: int) -> TimeAnchor:
    # Whole milliseconds, so the device and the server name exactly the same moment.
    moment = datetime.fromtimestamp(int(server_time.timestamp() * 1000) / 1000, tz=UTC)
    return TimeAnchor(server_time=moment, counter=counter, token=_token(kiosk_id, moment, counter))


def anchor_is_valid(kiosk_id: uuid.UUID, anchor: TimeAnchor) -> bool:
    return hmac.compare_digest(anchor.token, _token(kiosk_id, anchor.server_time, anchor.counter))


def anchor_for_request(request: Request, kiosk_id: uuid.UUID, server_time: datetime) -> TimeAnchor:
    """The anchor for the signed request being answered (require_kiosk keeps its counter)."""
    return make_anchor(kiosk_id, server_time, int(getattr(request.state, "kiosk_counter", 0)))
