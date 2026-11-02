"""Giving the gate screen its changing phone code (M4b spec §5.4, §7 rule 15).

The gate (a signed device request) asks every `refresh_in_seconds` for a new code. The answer holds
no code when the panel must not show: the setting is off, or the plant has no QR worker whose phone
punching is switched on (nobody could use it, so the screen stays quiet). That "is anyone eligible"
question is asked with one small count query, remembered for 60 seconds.
"""

import time
import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.modules.employees.models import Employee, EmployeeStatus, PunchMethod
from app.modules.kiosks.models import KioskDevice
from app.modules.phone.gate_code import issue_gate_code
from app.modules.phone.models import PhoneAccess
from app.modules.phone.rate_limits import gate_code_issue_limiter
from app.modules.settings.service import get_int_setting, get_setting

ELIGIBLE_CACHE_SECONDS = 60
_eligible_cache: dict[uuid.UUID, tuple[float, bool]] = {}


@dataclass(frozen=True)
class GateCodeAnswer:
    code_text: str | None
    svg: str | None
    issued_at: datetime
    expires_at: datetime
    refresh_in_seconds: int


def reset_eligibility_cache() -> None:
    _eligible_cache.clear()


def plant_has_phone_workers(session: Session, plant_id: uuid.UUID) -> bool:
    """Is there an active QR employee of the plant whose phone punching is ON? (cached 60 s)"""
    now = time.monotonic()
    cached = _eligible_cache.get(plant_id)
    if cached is not None and now - cached[0] < ELIGIBLE_CACHE_SECONDS:
        return cached[1]
    count = session.scalar(
        select(func.count())
        .select_from(Employee)
        .join(PhoneAccess, PhoneAccess.employee_id == Employee.id)
        .where(
            Employee.plant_id == plant_id,
            Employee.status == EmployeeStatus.ACTIVE.value,
            Employee.punch_method == PunchMethod.QR.value,
            PhoneAccess.phone_punch_enabled.is_(True),
        )
    )
    found = bool(count)
    _eligible_cache[plant_id] = (now, found)
    return found


def issue_for_gate(session: Session, kiosk: KioskDevice, now: datetime) -> GateCodeAnswer:
    if not gate_code_issue_limiter.allow(str(kiosk.id)):
        raise ApiError("TOO_MANY_REQUESTS", "Too many requests. Wait a moment.", 429)
    life = get_int_setting(session, "phone_gate_code_seconds")
    issued = issue_gate_code(kiosk.id, now, life)
    shown = get_setting(session, "kiosk_show_phone_code") == "on" and plant_has_phone_workers(
        session, kiosk.plant_id
    )
    return GateCodeAnswer(
        code_text=issued.text if shown else None,
        svg=issued.svg if shown else None,
        issued_at=issued.issued_at,
        expires_at=issued.expires_at,
        refresh_in_seconds=issued.refresh_in_seconds,
    )
