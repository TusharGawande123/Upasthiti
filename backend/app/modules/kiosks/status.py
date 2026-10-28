"""The state of an attendance device, worked out when it is read (M4 spec §7 rule 15).

Never stored, so there is no job that could fall behind:
  revoked                                       Switched off
  never paired                                  Waiting for pairing
  no signed request for `kiosk_offline_after_minutes`   Offline since <last contact>
  the last heartbeat said the location is not good      Needs location
  saved punches are waiting to be sent                  Sending saved punches (n)
  otherwise                                              Online
"""

import enum
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.modules.kiosks.models import KioskDevice, KioskStatus, LocationState
from app.modules.settings.service import get_int_setting


class DeviceState(enum.StrEnum):
    ONLINE = "online"
    OFFLINE = "offline"
    NEEDS_LOCATION = "needs_location"
    SENDING = "sending"
    REVOKED = "revoked"
    PENDING = "pending"


# A heartbeat that says one of these means the gate cannot punch right now. "stale" is not one of
# them: an offline gate may keep punching on its last good reading (spec §14 answer 1).
_LOCATION_PROBLEMS = frozenset(
    {
        LocationState.WEAK.value,
        LocationState.NONE.value,
        LocationState.DENIED.value,
        LocationState.OUTSIDE.value,
    }
)


def device_state(kiosk: KioskDevice, now: datetime, offline_after_minutes: int) -> DeviceState:
    if kiosk.status == KioskStatus.REVOKED.value:
        return DeviceState.REVOKED
    if kiosk.status == KioskStatus.PENDING.value:
        return DeviceState.PENDING
    last_contact = kiosk.last_seen_at
    if last_contact is None or now - last_contact >= timedelta(minutes=offline_after_minutes):
        return DeviceState.OFFLINE
    if kiosk.location_state in _LOCATION_PROBLEMS:
        return DeviceState.NEEDS_LOCATION
    if kiosk.queue_count > 0:
        return DeviceState.SENDING
    return DeviceState.ONLINE


def offline_after_minutes(session: Session) -> int:
    return get_int_setting(session, "kiosk_offline_after_minutes")


def is_working(state: DeviceState) -> bool:
    """Can punch right now: used by the plant readiness lines (spec §7 rule 15)."""
    return state in (DeviceState.ONLINE, DeviceState.SENDING)
