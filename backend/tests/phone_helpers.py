"""Phone punching rows for tests (M4b P0): a sign-in and a phone punch written straight into the
database, before the phone module exists. Fake data only."""

import hashlib
import uuid
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.core.time import utc_now
from app.modules.phone.models import PhoneSession
from app.modules.punches.models import Punch


def make_phone_session(
    session: Session, employee_id: uuid.UUID, now: datetime | None = None
) -> PhoneSession:
    started = now or utc_now()
    phone_session = PhoneSession(
        employee_id=employee_id,
        token_hash=hashlib.sha256(uuid.uuid4().bytes).hexdigest(),
        created_at=started,
        last_seen_at=started,
        expires_at=started + timedelta(days=30),
        browser="Chrome",
        system="Android",
    )
    session.add(phone_session)
    session.flush()
    return phone_session


def make_phone_punch(
    session: Session,
    phone_session: PhoneSession,
    plant_id: uuid.UUID,
    moment: datetime | None = None,
    **changes: object,
) -> Punch:
    """An accepted phone face punch (no gate device), unless `changes` say otherwise."""
    values: dict[str, object] = {
        "client_punch_id": uuid.uuid4(),
        "channel": "phone",
        "phone_session_id": phone_session.id,
        "kiosk_id": None,
        "plant_id": plant_id,
        "location_plant_id": plant_id,
        "employee_id": phone_session.employee_id,
        "method": "face",
        "match_mode": "one_to_one",
        "direction": "in",
        "decision": "accepted",
        "reason_codes": [],
        "server_received_at": moment or utc_now(),
        "lat": 19.87,
        "lon": 75.32,
        "accuracy_m": 12,
    }
    punch = Punch(**{**values, **changes})
    session.add(punch)
    session.flush()
    return punch
