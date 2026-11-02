"""Early OUT at the gate: the warning with the time that is left, and the token that carries the
person's "Agree" (decision 0036 lines 9 and 13).

When a person punches OUT before the shift end, the gate first shows an alert (Agree / Cancel).
The server does the arithmetic and the judging; the gate only shows it:

  1. The first request goes through every rule as usual. If the punch would be an accepted OUT
     before the shift end, nothing is stored. The answer is `needs_confirmation`, with how much of
     the half shift and of the full shift is left, and a signed token.
  2. Agree: the gate sends the token to `/punch/kiosk/early-out/confirm`. The server checks the
     token and the rules again at that moment and stores a normal accepted OUT, marked
     `EARLY_OUT_CONFIRMED`. Cancel (or 20 seconds of silence): the gate sends nothing and nothing
     is recorded.

The token holds only what the first request proved (who, by which method, the face scores). It is
signed with a key derived from APP_SECRET_KEY, belongs to one device and one punch id, and is good
for 90 seconds. Changing it changes nothing about the person: they are checked again.
"""

import hashlib
import hmac
import json
import math
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.offline_crypto import b64url_decode, b64url_encode
from app.core.time import to_ist
from app.modules.attendance.compute import shift_moments
from app.modules.attendance.day_window import AttendanceCalendar
from app.modules.kiosks.models import KioskDevice
from app.modules.punches.answers import early_out_answer
from app.modules.punches.counting import counted_between, last_counted_before
from app.modules.punches.models import Direction, Punch, PunchDecision, PunchMethod
from app.modules.punches.schemas import EarlyOutPrompt, KioskPunchResponse

TOKEN_LABEL = b"early-out-v1"
TOKEN_SECONDS = 90

EARLY_OUT_CONFIRMED = "EARLY_OUT_CONFIRMED"
EARLY_OUT_OFFLINE = "EARLY_OUT_OFFLINE"


@dataclass(frozen=True)
class EarlyOutInfo:
    tier: str  # "before_half" (the half shift is not complete) or "before_end"
    half_remaining_min: int | None  # only before the half shift is complete
    half_at: datetime | None
    full_remaining_min: int
    shift_end: datetime


def _whole_minutes_ceil(seconds: float) -> int:
    return max(1, math.ceil(seconds / 60))


def early_out_info(
    session: Session, employee_id: uuid.UUID, now: datetime, *, window_before_hours: int
) -> EarlyOutInfo | None:
    """What is left of the shift if this person leaves at `now`, or None when the shift is over
    (or there is no open IN or no shift to judge by).

    The half shift counts as in the day's "worked for status" (spec §7 rule 9): from the shift
    start when the IN was inside the grace, otherwise from the real IN.
    """
    opened = last_counted_before(session, employee_id, now)
    if opened is None or opened.direction != "in":
        return None
    calendar = AttendanceCalendar.load(
        session,
        [employee_id],
        to_ist(opened.punch_time).date(),
        to_ist(now).date(),
        window_before_hours=window_before_hours,
    )
    window = calendar.day_containing(employee_id, opened.punch_time)
    if window is None:
        return None
    rules = window.shift.rules
    start, end = shift_moments(window.day, rules)
    if now >= end:
        return None
    day_ins = [
        item
        for item in counted_between(session, employee_id, window.start, now)
        if item.direction == "in"
    ]
    first_in = day_ins[0].punch_time if day_ins else opened.punch_time
    counts_from = start if first_in <= start + timedelta(minutes=rules.grace_min) else first_in
    half_at = counts_from + timedelta(minutes=rules.half_day_min)
    full_remaining = _whole_minutes_ceil((end - now).total_seconds())
    if now < half_at:
        return EarlyOutInfo(
            tier="before_half",
            half_remaining_min=_whole_minutes_ceil((half_at - now).total_seconds()),
            half_at=half_at,
            full_remaining_min=full_remaining,
            shift_end=end,
        )
    return EarlyOutInfo(
        tier="before_end",
        half_remaining_min=None,
        half_at=None,
        full_remaining_min=full_remaining,
        shift_end=end,
    )


# --- The token ----------------------------------------------------------------------------------


def _key() -> bytes:
    secret = get_settings().app_secret_key.encode()
    return hmac.new(secret, TOKEN_LABEL, hashlib.sha256).digest()


def make_token(
    kiosk_id: uuid.UUID, client_punch_id: uuid.UUID, now: datetime, hold: dict[str, Any]
):
    """A signed, short-lived token for one device and one punch id. `hold` is what the first
    request proved (JSON values only)."""
    body = {
        "kiosk": str(kiosk_id),
        "punch": str(client_punch_id),
        "until": int((now + timedelta(seconds=TOKEN_SECONDS)).timestamp()),
        "hold": hold,
    }
    payload = b64url_encode(json.dumps(body, separators=(",", ":"), sort_keys=True).encode())
    mac = b64url_encode(hmac.new(_key(), payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{mac}"


def read_token(
    token: str, kiosk_id: uuid.UUID, client_punch_id: uuid.UUID, now: datetime
) -> dict[str, Any] | None:
    """The held facts, or None when the token is forged, expired, or for another device or punch."""
    try:
        payload, mac = token.split(".", 1)
        expected = b64url_encode(hmac.new(_key(), payload.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(mac, expected):
            return None
        body = json.loads(b64url_decode(payload))
        if body["kiosk"] != str(kiosk_id) or body["punch"] != str(client_punch_id):
            return None
        if now > datetime.fromtimestamp(body["until"], tz=UTC):
            return None
        return dict(body["hold"])
    except ValueError, KeyError, TypeError:
        return None


# --- Holding a punch for the alert, and the answer -------------------------------------------

# The columns of a face or code punch that the first request proved and the confirmation must
# keep (the face matched with these scores). Everything else is made fresh at confirmation.
HELD_FACE_COLUMNS = (
    "employee_id",
    "match_mode",
    "match_score",
    "second_best_score",
    "antispoof_score",
    "yaw_degrees",
    "challenge",
    "face_model_id",
    "claimed_employee_id",
    "follows_punch_id",
)


def punch_early_out(
    session: Session, punch: Punch, now: datetime, *, window_before_hours: int
) -> EarlyOutInfo | None:
    """The alert info when this (not yet stored) punch is a counted OUT before the shift end."""
    counts = punch.decision in (PunchDecision.ACCEPTED.value, PunchDecision.FLAGGED.value)
    if punch.direction != Direction.OUT.value or punch.employee_id is None or not counts:
        return None
    return early_out_info(session, punch.employee_id, now, window_before_hours=window_before_hours)


def face_hold(punch: Punch) -> dict[str, Any]:
    """What a face or code punch proved, as plain JSON values for the token."""
    held: dict[str, Any] = {"method": PunchMethod.FACE.value}
    for column in HELD_FACE_COLUMNS:
        value = getattr(punch, column)
        held[column] = None if value is None else str(value)
    return held


def prompt_for(
    kiosk: KioskDevice,
    now: datetime,
    info: EarlyOutInfo,
    hold: dict[str, Any],
    client_punch_id: uuid.UUID,
) -> KioskPunchResponse:
    """The "needs_confirmation" answer: nothing is stored, the gate shows the alert."""
    prompt = EarlyOutPrompt(
        token=make_token(kiosk.id, client_punch_id, now, hold),
        client_punch_id=client_punch_id,
        expires_at=now + timedelta(seconds=TOKEN_SECONDS),
        tier=info.tier,  # type: ignore[arg-type]
        half_remaining_min=info.half_remaining_min,
        half_at=info.half_at,
        full_remaining_min=info.full_remaining_min,
        shift_end=info.shift_end,
    )
    return early_out_answer(kiosk.name, now, prompt)
