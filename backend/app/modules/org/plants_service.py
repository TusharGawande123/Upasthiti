"""Plants: list, create, edit, switch off/on, and the one-click seven client plants.

Every new plant gets the defaults the client asked for (spec §7 rule 16): the shift
"General 07:00–19:00" and the categories Staff, Worker, Operator, Helper. All of them can be
changed later.
"""

import re
import uuid
from datetime import time
from decimal import Decimal

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.pagination import PageParams, fetch_page
from app.modules.audit.service import Actor, record_audit
from app.modules.org.client_plants import CLIENT_PLANTS
from app.modules.org.models import EmployeeCategory, Plant, Shift
from app.modules.org.readiness_service import count_active_kiosks

PLANT_CODE_PATTERN = re.compile(r"^[A-Z0-9]{2,10}$")
DEFAULT_SHIFT_NAME = "General"
DEFAULT_SHIFT_START = time(7, 0)
DEFAULT_SHIFT_END = time(19, 0)
DEFAULT_GRACE_MIN = 10
DEFAULT_HALF_DAY_MIN = 240
DEFAULT_OT_AFTER_MIN = 480  # overtime after 8 worked hours (client answer Q5)
DEFAULT_CATEGORIES = ("Staff", "Worker", "Operator", "Helper")


def plant_snapshot(plant: Plant) -> dict[str, object]:
    return {
        "name": plant.name,
        "code": plant.code,
        "address": plant.address,
        "lat": plant.lat,
        "lon": plant.lon,
        "is_active": plant.is_active,
    }


def list_plants(
    session: Session,
    params: PageParams,
    *,
    only_plant_ids: frozenset[uuid.UUID] | None,
    is_active: bool | None = None,
    search: str | None = None,
) -> tuple[list[Plant], int]:
    statement = select(Plant).order_by(Plant.code)
    if only_plant_ids is not None:
        statement = statement.where(Plant.id.in_(only_plant_ids))
    if is_active is not None:
        statement = statement.where(Plant.is_active == is_active)
    if search:
        pattern = f"%{search.strip().lower()}%"
        statement = statement.where(
            or_(func.lower(Plant.name).like(pattern), func.lower(Plant.code).like(pattern))
        )
    return fetch_page(session, statement, params)


def get_plant(session: Session, plant_id: uuid.UUID) -> Plant:
    plant = session.get(Plant, plant_id)
    if plant is None:
        raise ApiError("PLANT_NOT_FOUND", "Plant not found.", 404)
    return plant


def create_plant(
    session: Session,
    *,
    actor: Actor,
    name: str,
    code: str,
    address: str,
    lat: Decimal | None,
    lon: Decimal | None,
) -> Plant:
    code = _clean_code(code)
    if session.scalar(select(Plant.id).where(Plant.code == code)):
        raise ApiError("PLANT_CODE_EXISTS", "Another plant already uses this code.", 409)
    _check_position(lat, lon)

    plant = Plant(name=name.strip(), code=code, address=address.strip(), lat=lat, lon=lon)
    session.add(plant)
    session.flush()
    _add_new_plant_defaults(session, plant)
    record_audit(
        session,
        actor=actor,
        action="plant.create",
        entity_type="plant",
        entity_id=plant.id,
        after=plant_snapshot(plant),
        plant_id=plant.id,
    )
    session.commit()
    return plant


def update_plant(
    session: Session,
    *,
    actor: Actor,
    plant: Plant,
    name: str | None,
    address: str | None,
    lat: Decimal | None,
    lon: Decimal | None,
    position_given: bool,
) -> Plant:
    before = plant_snapshot(plant)
    if name is not None:
        plant.name = name.strip()
    if address is not None:
        plant.address = address.strip()
    if position_given:
        _check_position(lat, lon)
        plant.lat, plant.lon = lat, lon
    record_audit(
        session,
        actor=actor,
        action="plant.update",
        entity_type="plant",
        entity_id=plant.id,
        before=before,
        after=plant_snapshot(plant),
        plant_id=plant.id,
    )
    session.commit()
    return plant


def set_plant_active(
    session: Session, *, actor: Actor, plant: Plant, active: bool, reason: str
) -> Plant:
    if not active:
        _check_no_active_kiosks(session, plant)
    before = plant_snapshot(plant)
    plant.is_active = active
    record_audit(
        session,
        actor=actor,
        action="plant.reactivate" if active else "plant.deactivate",
        entity_type="plant",
        entity_id=plant.id,
        before=before,
        after=plant_snapshot(plant),
        reason=reason,
        plant_id=plant.id,
    )
    session.commit()
    return plant


def add_client_plants(session: Session, *, actor: Actor) -> tuple[int, int]:
    """Create the seven Sheet Shapers plants; codes that exist are skipped (safe to repeat)."""
    existing_codes = set(session.scalars(select(Plant.code)))
    created = 0
    for client_plant in CLIENT_PLANTS:
        if client_plant.code in existing_codes:
            continue
        plant = Plant(name=client_plant.name, code=client_plant.code, address=client_plant.address)
        session.add(plant)
        session.flush()
        _add_new_plant_defaults(session, plant)
        record_audit(
            session,
            actor=actor,
            action="plant.create",
            entity_type="plant",
            entity_id=plant.id,
            after=plant_snapshot(plant),
            reason="Added from the client's plant list",
            plant_id=plant.id,
        )
        created += 1
    session.commit()
    return created, len(CLIENT_PLANTS) - created


def _add_new_plant_defaults(session: Session, plant: Plant) -> None:
    session.add(
        Shift(
            plant_id=plant.id,
            name=DEFAULT_SHIFT_NAME,
            start_time=DEFAULT_SHIFT_START,
            end_time=DEFAULT_SHIFT_END,
            crosses_midnight=False,
            grace_min=DEFAULT_GRACE_MIN,
            half_day_min=DEFAULT_HALF_DAY_MIN,
            ot_after_min=DEFAULT_OT_AFTER_MIN,
        )
    )
    for category_name in DEFAULT_CATEGORIES:
        session.add(EmployeeCategory(plant_id=plant.id, name=category_name))


def _check_no_active_kiosks(session: Session, plant: Plant) -> None:
    active_kiosks = count_active_kiosks(session, plant.id)
    if active_kiosks:
        raise ApiError(
            "PLANT_HAS_ACTIVE_KIOSKS",
            "Revoke this plant's kiosks first.",
            409,
            {"count": active_kiosks},
        )


def _clean_code(code: str) -> str:
    cleaned = code.strip().upper()
    if not PLANT_CODE_PATTERN.match(cleaned):
        raise ApiError("PLANT_CODE_INVALID", "Use 2–10 capital letters or digits.", 422)
    return cleaned


def _check_position(lat: Decimal | None, lon: Decimal | None) -> None:
    if (lat is None) != (lon is None):
        raise ApiError("PLANT_POSITION_INVALID", "Give both latitude and longitude.", 422)
    if lat is not None and lon is not None and not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ApiError("PLANT_POSITION_INVALID", "This map position is not valid.", 422)
