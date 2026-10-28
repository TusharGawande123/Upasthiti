"""A made-up gate position and fence for throw-away databases (tests, memory check, load test).

From M4 every punch must report a position inside its plant's fence, so the tools that send
signed punches need a plant with a fence and a matching position. Never used on real plants.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.org.models import Geofence

GATE_LAT, GATE_LON = 19.8500, 75.2500
GATE_FENCE_RADIUS_M = 200
GATE_FENCE_MARGIN_M = 25
# What a gate device sends with each punch: a good reading, 3 seconds old.
GATE_LOCATION = {"lat": GATE_LAT, "lon": GATE_LON, "accuracy_m": 12.0, "age_s": 3}


def ensure_gate_fence(session: Session, plant_id: uuid.UUID) -> Geofence:
    """A circle fence around the made-up gate for the plant, unless it already has one."""
    fence = session.scalar(
        select(Geofence).where(Geofence.plant_id == plant_id, Geofence.is_current.is_(True))
    )
    if fence is None:
        fence = Geofence(
            plant_id=plant_id,
            version=1,
            shape="circle",
            geojson={"type": "Point", "coordinates": [GATE_LON, GATE_LAT]},
            radius_m=GATE_FENCE_RADIUS_M,
            buffer_m=GATE_FENCE_MARGIN_M,
            is_current=True,
        )
        session.add(fence)
        session.flush()
    return fence
