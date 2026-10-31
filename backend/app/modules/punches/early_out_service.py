"""Agree at the early-OUT alert: store the OUT the person confirmed (decision 0036 line 9).

The first request already proved who the person is and that the punch is an OUT before the shift
end; it stored nothing and handed the gate a signed token (early_out.py). Here the server checks
the token, then decides the punch again at THIS moment, so a person who was punched meanwhile at
another gate, a revoked card or a device that moved are all judged as they are now.

- Card punch: the token holds the card text; the whole card chain runs again with the photo the
  gate sends again, exactly like a new scan, and the OUT is marked EARLY_OUT_CONFIRMED.
- Face and code punch: the token holds what the face match proved (the scores). The location rules
  and the IN/OUT and flag rules run again with that person, and the punch row is made from the
  held facts. A face punch stores no picture, so nothing more is needed.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.antiproxy.context import Outcome
from app.antiproxy.engine import LOCATION_RULES, combine, rejected_after, run_rules
from app.core.errors import ApiError
from app.core.storage import Storage
from app.core.time import utc_now
from app.modules.attendance.service import mark_punch_stale
from app.modules.employees.models import Employee, EmployeeStatus
from app.modules.kiosks.models import KioskDevice
from app.modules.punches import face_service, service
from app.modules.punches.answers import punch_answer
from app.modules.punches.early_out import (
    EARLY_OUT_CONFIRMED,
    punch_early_out,
    read_token,
)
from app.modules.punches.models import Punch, PunchMethod
from app.modules.punches.schemas import (
    EarlyOutConfirmRequest,
    KioskPunchRequest,
    KioskPunchResponse,
)

# Held columns that are numbers or ids, with how to read them back from the token's text.
_DECIMAL_COLUMNS = ("match_score", "second_best_score", "antispoof_score", "yaw_degrees")
_ID_COLUMNS = ("claimed_employee_id", "follows_punch_id")


def confirm_early_out(
    session: Session,
    kiosk: KioskDevice,
    body: EarlyOutConfirmRequest,
    client: service.ClientInfo,
    storage: Storage | None = None,
) -> KioskPunchResponse:
    limits = service.load_limits(session)
    stored = service.find_punch(session, kiosk, body.client_punch_id)
    if stored is not None:  # a retry of the same Agree gets the same answer
        return punch_answer(session, stored, kiosk.name, limits)

    now = utc_now()
    hold = read_token(body.token, kiosk.id, body.client_punch_id, now)
    if hold is None:
        raise ApiError(
            "EARLY_OUT_TOKEN_INVALID", "The confirmation is too old. Please punch again.", 409
        )
    if hold.get("method") == PunchMethod.QR.value:
        request = KioskPunchRequest(
            client_punch_id=body.client_punch_id,
            method="qr",
            qr_payload=str(hold["qr_text"]),
            snapshot_jpeg=body.snapshot_jpeg,
            device_time=body.device_time,
            location=body.location,
            app_version=body.app_version,
        )
        return service.record_kiosk_punch(
            session, kiosk, request, client, storage, early_out_confirmed=True
        )
    return _confirm_face_or_code(session, kiosk, body, hold, client, now)


def _confirm_face_or_code(
    session: Session,
    kiosk: KioskDevice,
    body: EarlyOutConfirmRequest,
    hold: dict[str, Any],
    client: service.ClientInfo,
    now: datetime,
) -> KioskPunchResponse:
    limits = service.load_limits(session)
    employee = session.get(Employee, uuid.UUID(str(hold["employee_id"])))
    if employee is None:
        raise ApiError("EARLY_OUT_TOKEN_INVALID", "Please punch again.", 409)

    place = face_service.place_context(
        session, kiosk, now, limits, service.reported_location_of(body.location), None
    )
    place.location_age_s = body.location.age_s if body.location else None
    place.employee = employee
    place_decision = run_rules(place, LOCATION_RULES)
    if place_decision.outcome is Outcome.REJECT:
        decision = place_decision
    elif employee.status != EmployeeStatus.ACTIVE.value:
        decision = rejected_after(place_decision, "EMPLOYEE_INACTIVE")
    elif employee.plant_id != kiosk.plant_id:
        decision = rejected_after(place_decision, "WRONG_PLANT")
    else:
        decision = combine(place_decision, face_service.after_identity(session, place))

    counts = decision.outcome is Outcome.ALLOW
    punch = Punch(
        id=uuid.uuid4(),
        client_punch_id=body.client_punch_id,
        kiosk_id=kiosk.id,
        plant_id=kiosk.plant_id,
        employee_id=employee.id,
        method=PunchMethod.FACE.value,
        direction=decision.direction.value if counts and decision.direction else None,
        decision=decision.decision_value,
        reason_codes=decision.reason_codes,
        server_received_at=now,
        device_claimed_at=body.device_time,
        lat=body.location.lat if body.location else None,
        lon=body.location.lon if body.location else None,
        accuracy_m=body.location.accuracy_m if body.location else None,
        location_age_s=body.location.age_s if body.location else None,
        geofence_id=place.geofence_id,
        geofence_distance_m=service.metres(place.geofence_distance_m),
        related_punch_id=place.related_punch_id,
        ip=client.ip,
        app_version=body.app_version,
        **_held_columns(hold),
    )
    if punch_early_out(
        session, punch, now, window_before_hours=limits.attendance_window_before_hours
    ):
        punch.early_out_mark = EARLY_OUT_CONFIRMED
    try:
        session.add(punch)
        service.note_last_punch(kiosk, punch)
        mark_punch_stale(session, punch)
        session.commit()
    except IntegrityError:
        session.rollback()
        winner = service.find_punch(session, kiosk, body.client_punch_id)
        if winner is None:
            raise
        punch = winner
    return punch_answer(session, punch, kiosk.name, limits)


def _held_columns(hold: dict[str, Any]) -> dict[str, Any]:
    """The facts the first request proved, back from the token's text into column values."""
    columns: dict[str, Any] = {
        "match_mode": hold.get("match_mode"),
        "challenge": hold.get("challenge"),
        "face_model_id": hold.get("face_model_id"),
    }
    for name in _DECIMAL_COLUMNS:
        columns[name] = Decimal(hold[name]) if hold.get(name) is not None else None
    for name in _ID_COLUMNS:
        columns[name] = uuid.UUID(hold[name]) if hold.get(name) is not None else None
    return columns
