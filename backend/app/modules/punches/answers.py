"""Turns a stored punch into the answer the kiosk gets (spec M2 §5.2).

The answer is always built from the stored rows, for a new punch and for a retry alike, so a
kiosk that lost the first answer gets exactly the same one the second time.
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.antiproxy.context import PunchLimits
from app.modules.employees.models import Employee
from app.modules.punches.models import Direction, Punch, PunchDecision, PunchMethod
from app.modules.punches.schemas import KioskPunchResponse, PunchDetails, PunchEmployee

# Two rejections are not really "no": the person IS checked in, they only scanned too soon.
# They carry the name and the time of the earlier punch, and keep no new photo.
ALREADY_PUNCHED_CODES = ("COOLDOWN_ACTIVE", "OUT_TOO_SOON")
# Face rejections where a new try can help: the gate offers "Try again" (spec M3 §4.6).
FACE_RETRY_CODES = (
    "NO_FACE",
    "MULTIPLE_FACES",
    "FACE_TOO_SMALL",
    "FACE_QUALITY_LOW",
    "LIVENESS_FAILED",
    "CHALLENGE_EXPIRED",
    "FACE_INCONSISTENT",
)


def punch_answer(
    session: Session, punch: Punch, kiosk_name: str, limits: PunchLimits
) -> KioskPunchResponse:
    reason_code = punch.reason_codes[0] if punch.reason_codes else None
    accepted = punch.decision == PunchDecision.ACCEPTED.value
    needs_code = punch.decision == PunchDecision.NEEDS_CODE.value
    already_punched = reason_code in ALREADY_PUNCHED_CODES

    details = PunchDetails(kiosk_name=kiosk_name)
    employee: PunchEmployee | None = None
    # The name is shown only to someone who proved the card is theirs and works here. Other
    # rejections (wrong plant, not a QR employee...) never reveal who owns the card (FR-20).
    if (accepted or already_punched) and punch.employee_id is not None:
        found = session.get(Employee, punch.employee_id)
        if found is not None:
            employee = PunchEmployee(
                display_name=found.full_name, employee_code=found.employee_code
            )
    if already_punched and punch.employee_id is not None:
        details = _earlier_punch_details(session, punch, kiosk_name, limits)
    if punch.method == PunchMethod.FACE.value and not accepted:
        details.retry_allowed = reason_code in FACE_RETRY_CODES

    return KioskPunchResponse(
        punch_id=punch.id,
        decision="accepted" if accepted else ("needs_code" if needs_code else "rejected"),
        direction=punch.direction if accepted else None,  # type: ignore[arg-type]
        employee=employee,
        server_time=punch.server_received_at,
        reason_code=reason_code,
        message_key=_message_key(punch, reason_code),
        voice_key=_voice_key(punch, reason_code, details),
        details=details,
    )


def self_test_answer(kiosk_name: str, server_time: datetime) -> KioskPunchResponse:
    return KioskPunchResponse(
        punch_id=None,
        decision="self_test",
        direction=None,
        employee=None,
        server_time=server_time,
        reason_code=None,
        message_key="kiosk.punch.selfTest",
        voice_key="kiosk.voice.selfTest",
        details=PunchDetails(kiosk_name=kiosk_name),
    )


def refused_test_card_answer(
    kiosk_name: str, reason_code: str, server_time: datetime
) -> KioskPunchResponse:
    """A refused TEST card (revoked): shown like any rejection, but no punch row is made."""
    return KioskPunchResponse(
        punch_id=None,
        decision="rejected",
        direction=None,
        employee=None,
        server_time=server_time,
        reason_code=reason_code,
        message_key=f"kiosk.punch.{reason_code}",
        voice_key=f"kiosk.punch.{reason_code}.voice",
        details=PunchDetails(kiosk_name=kiosk_name),
    )


def _earlier_punch_details(
    session: Session, punch: Punch, kiosk_name: str, limits: PunchLimits
) -> PunchDetails:
    """The accepted punch that came right before this rejected one."""
    earlier = session.scalar(
        select(Punch)
        .where(
            Punch.employee_id == punch.employee_id,
            Punch.decision == PunchDecision.ACCEPTED.value,
            Punch.server_received_at < punch.server_received_at,
        )
        .order_by(Punch.server_received_at.desc())
        .limit(1)
    )
    if earlier is None:
        return PunchDetails(kiosk_name=kiosk_name)
    out_allowed_from = None
    if earlier.direction == Direction.IN.value:
        out_allowed_from = earlier.server_received_at + timedelta(
            minutes=limits.min_minutes_before_out
        )
    return PunchDetails(
        kiosk_name=kiosk_name,
        last_direction=earlier.direction,  # type: ignore[arg-type]
        last_punch_at=earlier.server_received_at.astimezone(UTC),
        out_allowed_from=out_allowed_from,
    )


def _message_key(punch: Punch, reason_code: str | None) -> str:
    if reason_code is None:
        return f"kiosk.punch.accepted.{punch.direction}"
    if reason_code == "WRONG_PLANT" and punch.method == PunchMethod.FACE.value:
        # The card text speaks of "this card"; a face punch gets its own words.
        return "kiosk.punch.WRONG_PLANT_FACE"
    return f"kiosk.punch.{reason_code}"


def _voice_key(punch: Punch, reason_code: str | None, details: PunchDetails) -> str:
    """The spoken line (never with a name). Rejections use their own line."""
    if reason_code is None:
        return f"kiosk.voice.{punch.direction}"
    if reason_code in ALREADY_PUNCHED_CODES:
        return (
            "kiosk.voice.alreadyOut" if details.last_direction == "out" else "kiosk.voice.alreadyIn"
        )
    return f"kiosk.punch.{reason_code}.voice"
