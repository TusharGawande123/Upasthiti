"""Takes away a plant's current geofence, so the plant has NO fence until one is drawn again:

    uv run python -m app.scripts.clear_geofence --plant-code K134             (only shows)
    uv run python -m app.scripts.clear_geofence --plant-code K134 --confirm   (clears)

Why this exists: a test fence was drawn on a real plant (decision 0032) and the lead wants the plant
to have no fence until the real one is drawn on site. The screens can only replace a fence, never
take it away.

Nothing is deleted. Every saved version stays (punches point at the version they were judged
against), only the "current" mark is removed, and one audit line "geofence.clear" says so. Without
a current fence no attendance device of that plant can pair or punch (GEOFENCE_NOT_SET), so the
tool refuses while the plant still has a working or waiting device. Drawing a fence on the Plants
screen later makes a new current version as usual.

Run it from the laptop with DATABASE_URL set for this one command only; then remove it again.
"""

import argparse
import sys

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.config import load_settings_or_exit
from app.core.db import get_session_factory
from app.modules import all_models  # noqa: F401  (makes every table known to Base.metadata)
from app.modules.audit.service import SYSTEM_ACTOR, record_audit
from app.modules.kiosks.models import KioskDevice, KioskStatus
from app.modules.org.geofence_service import current_geofence
from app.modules.org.models import Geofence, Plant


class ClearRefusedError(Exception):
    """The fence was not cleared; the message says why."""


def find_plant_and_fence(session: Session, plant_code: str) -> tuple[Plant, Geofence]:
    """Finds the plant and its fence, and checks no device still needs it. Changes nothing."""
    code = plant_code.strip().upper()
    plant = session.scalar(select(Plant).where(Plant.code == code))
    if plant is None:
        raise ClearRefusedError(f"There is no plant with the code {code!r}.")
    fence = current_geofence(session, plant.id)
    if fence is None:
        raise ClearRefusedError(f"Plant {code} has no current geofence: nothing to clear.")
    devices_in_use = session.scalar(
        select(func.count())
        .select_from(KioskDevice)
        .where(KioskDevice.plant_id == plant.id, KioskDevice.status != KioskStatus.REVOKED.value)
    )
    if devices_in_use:
        raise ClearRefusedError(
            f"Plant {code} still has {devices_in_use} attendance device(s) that are not switched "
            "off. Without a fence they cannot punch: switch them off first (Attendance devices)."
        )
    return plant, fence


def clear(session: Session, plant: Plant, fence: Geofence) -> None:
    """Removes the current mark and writes the audit line. The caller commits."""
    session.execute(update(Geofence).where(Geofence.plant_id == plant.id).values(is_current=False))
    record_audit(
        session,
        actor=SYSTEM_ACTOR,
        action="geofence.clear",
        entity_type="plant",
        entity_id=plant.id,
        before={"version": fence.version, "shape": fence.shape},
        after=None,
        reason="No fence until the real one is drawn on site (decision 0033).",
        plant_id=plant.id,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Take away a plant's current geofence.")
    parser.add_argument("--plant-code", required=True, help="e.g. K134")
    parser.add_argument("--confirm", action="store_true", help="really clear (default: only show)")
    arguments = parser.parse_args()

    load_settings_or_exit()
    with get_session_factory()() as session:
        try:
            plant, fence = find_plant_and_fence(session, arguments.plant_code)
        except ClearRefusedError as error:
            print(f"Refused: {error}")
            return 1
        print(
            f"Plant: {plant.code} ({plant.name}); current geofence: version {fence.version}, "
            f"{fence.shape}. Old versions stay; the plant will have NO fence after this."
        )
        if not arguments.confirm:
            print("\nNothing was changed. Run again with --confirm to clear it.")
            return 0
        typed = input(f"\nType the plant code ({plant.code}) to clear its fence: ").strip()
        if typed != plant.code:
            print("Not the same code: nothing was changed.")
            return 1
        clear(session, plant, fence)
        session.commit()

    print("Geofence cleared. Draw the real one on the Plants screen when you are on site.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
