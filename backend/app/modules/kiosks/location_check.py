"""Is a gate device where it should be? One check for pairing and every punch (M4 spec §7 rule 4).

The device reports a position and its accuracy; the server judges it against the plant's fence:
  no position                          LOCATION_REQUIRED
  accuracy worse than the setting      GPS_ACCURACY_TOO_LOW
  the plant has no fence               GEOFENCE_NOT_SET
  inside the drawn shape               fine
  outside the shape, within the margin fine, but marked "at the edge" (a punch gets a flag)
  beyond the margin                    OUTSIDE_GEOFENCE
A faked browser location passes this check: it is a strong signal, not a proof (decision 0005).
"""

import uuid
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.org.geofence import distance_to_geofence_m
from app.modules.org.geofence_service import current_geofence
from app.modules.org.models import Geofence
from app.modules.settings.service import get_int_setting

# A reported accuracy beyond this is nonsense and is treated as "not accurate enough".
MAX_ACCURACY_REPORTED_M = 100_000

# What each refusal says to an admin (people at the gate see their own translated texts).
REFUSAL_MESSAGES = {
    "LOCATION_REQUIRED": "This device did not report its location.",
    "GPS_ACCURACY_TOO_LOW": "The location is not accurate enough.",
    "GEOFENCE_NOT_SET": "This plant has no geofence.",
    "OUTSIDE_GEOFENCE": "This device is not at the plant.",
}


@dataclass(frozen=True)
class Location:
    lat: float
    lon: float
    accuracy_m: float


@dataclass(frozen=True)
class LocationVerdict:
    refusal_code: str | None = None  # one of REFUSAL_MESSAGES, or None when the place is fine
    at_edge: bool = False  # outside the drawn shape but inside the margin
    geofence: Geofence | None = None  # the fence version the position was judged against
    distance_m: float | None = None  # 0 inside the drawn shape
    details: dict[str, object] = field(default_factory=dict)

    @property
    def is_refused(self) -> bool:
        return self.refusal_code is not None


def geofence_at(session: Session, plant_id: uuid.UUID, moment: datetime | None) -> Geofence | None:
    """The fence version that was current at `moment` (None = now). Versions are never edited,
    so an offline punch is judged against the fence of its own time, not today's."""
    if moment is None:
        return current_geofence(session, plant_id)
    version = session.scalar(
        select(Geofence)
        .where(Geofence.plant_id == plant_id, Geofence.created_at <= moment)
        .order_by(Geofence.version.desc())
        .limit(1)
    )
    # A moment before the first fence cannot happen for a paired device; fall back to today's.
    return version or current_geofence(session, plant_id)


def check_location(
    session: Session,
    plant_id: uuid.UUID,
    location: Location | None,
    moment: datetime | None = None,
) -> LocationVerdict:
    if location is None:
        return LocationVerdict("LOCATION_REQUIRED")
    limit = get_int_setting(session, "gps_accuracy_limit_m")
    accuracy_is_known = 0 <= location.accuracy_m <= MAX_ACCURACY_REPORTED_M
    if not accuracy_is_known or location.accuracy_m > limit:
        details: dict[str, object] = {"accuracy_m": round(location.accuracy_m), "limit_m": limit}
        return LocationVerdict("GPS_ACCURACY_TOO_LOW", details=details)

    geofence = geofence_at(session, plant_id, moment)
    if geofence is None:
        return LocationVerdict("GEOFENCE_NOT_SET")
    distance = distance_to_geofence_m(
        geofence.shape, geofence.geojson, geofence.radius_m, location.lon, location.lat
    )
    if distance > geofence.buffer_m:
        return LocationVerdict(
            "OUTSIDE_GEOFENCE",
            geofence=geofence,
            distance_m=distance,
            details={"distance_m": round(distance)},
        )
    return LocationVerdict(at_edge=distance > 0, geofence=geofence, distance_m=distance)
