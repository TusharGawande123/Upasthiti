"""A phone gate-code punch whose selfie has no face: tell the Super Admin (decision 0036).

The punch decision does not change: the gate code and the sign-in are the proof, the selfie is only
a photo for review. When the face check F-30 finds no face on it, one bell notice per plant and day
says how many such selfies there are. It holds counts and the plant code only, no name.
"""

import uuid
from datetime import date, datetime, time, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.time import IST, to_ist
from app.modules.notifications.service import create_notification, update_open_notification
from app.modules.org.models import Plant
from app.modules.punches.models import Punch, PunchSnapshot, SnapshotReason

KIND = "phone_selfie_no_face"


def count_without_face(
    session: Session, day: date, plant_id: uuid.UUID | None = None
) -> dict[uuid.UUID, int]:
    """Phone gate-code selfies of one IST day on which no face was found, per plant."""
    start = datetime.combine(day, time.min, tzinfo=IST)
    end = start + timedelta(days=1)
    statement = (
        select(Punch.plant_id, func.count())
        .join(PunchSnapshot, PunchSnapshot.punch_id == Punch.id)
        .where(
            PunchSnapshot.reason == SnapshotReason.PHONE_GATE_CODE.value,
            PunchSnapshot.face_found.is_(False),
            Punch.punch_time >= start,
            Punch.punch_time < end,
        )
        .group_by(Punch.plant_id)
    )
    if plant_id is not None:
        statement = statement.where(Punch.plant_id == plant_id)
    return {row[0]: row[1] for row in session.execute(statement)}


def note_selfie_without_face(session: Session, snapshot: PunchSnapshot, now: datetime) -> None:
    """Called after F-30 stored `face_found = False`. The caller commits."""
    punch = session.get(Punch, snapshot.punch_id)
    if punch is None or snapshot.reason != SnapshotReason.PHONE_GATE_CODE.value:
        return
    day = to_ist(punch.punch_time).date()
    plant = session.get(Plant, punch.plant_id)
    count = count_without_face(session, day, punch.plant_id).get(punch.plant_id, 0)
    params = {"count": count, "plant": plant.code if plant else "", "date": day.isoformat()}
    key = f"{KIND}:{punch.plant_id}:{day}"
    created = create_notification(
        session,
        kind=KIND,
        severity="warning",
        plant_id=punch.plant_id,
        text_key=f"notification.{KIND}",
        params=params,
        link="/admin/punches?method=gate_code",
        dedupe_key=key,
        now=now,
    )
    if created is None:
        update_open_notification(session, key, params=params, subject_ids=[])
