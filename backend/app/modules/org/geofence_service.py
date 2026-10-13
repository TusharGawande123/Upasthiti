"""Saving and reading geofence versions (SRS FR-02, spec §7 rule 7).

A save never edits a version: it adds version n+1 and marks it current, so the shape that
was valid on any past day can always be shown again.
"""

import uuid
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.modules.audit.service import Actor, record_audit
from app.modules.org.geofence import check_shape
from app.modules.org.models import Geofence, Plant


def current_geofence(session: Session, plant_id: uuid.UUID) -> Geofence | None:
    return session.scalar(
        select(Geofence).where(Geofence.plant_id == plant_id, Geofence.is_current.is_(True))
    )


def geofence_versions(session: Session, plant_id: uuid.UUID) -> list[Geofence]:
    return list(
        session.scalars(
            select(Geofence).where(Geofence.plant_id == plant_id).order_by(Geofence.version.desc())
        )
    )


def save_geofence(
    session: Session,
    *,
    actor: Actor,
    plant: Plant,
    shape: str,
    geojson: dict[str, Any],
    radius_m: float | None,
    buffer_m: int,
    reason: str | None,
) -> Geofence:
    checked = check_shape(shape, geojson, radius_m, buffer_m)
    previous = current_geofence(session, plant.id)
    last_version = session.scalar(
        select(func.max(Geofence.version)).where(Geofence.plant_id == plant.id)
    )

    session.execute(update(Geofence).where(Geofence.plant_id == plant.id).values(is_current=False))
    geofence = Geofence(
        plant_id=plant.id,
        version=(last_version or 0) + 1,
        shape=checked.shape,
        geojson=checked.geojson,
        radius_m=checked.radius_m,
        buffer_m=buffer_m,
        is_current=True,
        created_by=actor.actor_id,
    )
    session.add(geofence)
    session.flush()
    record_audit(
        session,
        actor=actor,
        action="geofence.save",
        entity_type="plant",
        entity_id=plant.id,
        before=_summary(previous) if previous else None,
        after=_summary(geofence),
        reason=reason,
        plant_id=plant.id,
    )
    session.commit()
    return geofence


def require_current_geofence(session: Session, plant_id: uuid.UUID) -> Geofence:
    geofence = current_geofence(session, plant_id)
    if geofence is None:
        raise ApiError("GEOFENCE_NOT_SET", "Draw this plant's geofence first.", 404)
    return geofence


def _summary(geofence: Geofence) -> dict[str, object]:
    # The full shape is kept in the geofences table; the audit shows what kind it was.
    return {
        "version": geofence.version,
        "shape": geofence.shape,
        "radius_m": geofence.radius_m,
        "buffer_m": geofence.buffer_m,
    }
