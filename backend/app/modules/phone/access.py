"""Reading the Super Admin's two phone switches (M4b spec §7 rule 3). No row means both OFF.

Small on purpose: the sign-in check, the punch rules (P2) and the screens all ask the same two
questions, so the answers live in one place.
"""

import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.phone.models import PhoneAccess


def access_of(session: Session, employee_id: uuid.UUID) -> PhoneAccess | None:
    return session.scalar(select(PhoneAccess).where(PhoneAccess.employee_id == employee_id))


def phone_punch_on(session: Session, employee_id: uuid.UUID) -> bool:
    access = access_of(session, employee_id)
    return access is not None and access.phone_punch_enabled


def outside_work_allowed_on(access: PhoneAccess | None, day: date) -> bool:
    """Outside work counts on `day` (an IST date) while the switch is ON and the "until" date
    (F-69), when set, is not over: the whole last day counts. After it the switch may still be
    stored as ON until the daily job turns it off, but it no longer allows anything."""
    if access is None or not access.phone_punch_enabled or not access.outside_work_allowed:
        return False
    return access.outside_work_until is None or day <= access.outside_work_until
