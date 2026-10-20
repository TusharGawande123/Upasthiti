"""Turns punch rows into punch-log answers, with the viewer's rules applied (spec M2 §4.10, §5.3):
- a viewer limited to some plants (Plant Head) never sees the name or code of an employee of
  another plant; that row says "Card of another plant" (nothing of other plants leaks);
- only the Super Admin learns whether a photo is dark (F-31);
- the storage key, the IP address and the photo itself are never part of these answers.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.employees.models import Employee
from app.modules.kiosks.models import KioskDevice
from app.modules.org.models import Plant
from app.modules.punches.models import Punch, PunchSnapshot
from app.modules.punches.schemas import (
    PunchDetail,
    PunchLocation,
    PunchLogEmployee,
    PunchLogItem,
    PunchLogPlace,
    PunchLogSnapshot,
)


@dataclass(frozen=True)
class Viewer:
    only_plant_ids: frozenset[uuid.UUID] | None  # None = every plant
    sees_dark_photos: bool  # the Super Admin


@dataclass(frozen=True)
class _Related:
    employees: dict[uuid.UUID, Employee]
    kiosks: dict[uuid.UUID, KioskDevice]
    plants: dict[uuid.UUID, Plant]
    snapshots: dict[uuid.UUID, PunchSnapshot]


def _load_related(session: Session, punches: Sequence[Punch]) -> _Related:
    """Everything the rows refer to, in four queries for the whole page."""

    def by_id(model: type, ids: set[uuid.UUID]) -> dict:
        if not ids:
            return {}
        return {row.id: row for row in session.scalars(select(model).where(model.id.in_(ids)))}

    snapshots = (
        {
            row.punch_id: row
            for row in session.scalars(
                select(PunchSnapshot).where(PunchSnapshot.punch_id.in_([p.id for p in punches]))
            )
        }
        if punches
        else {}
    )
    return _Related(
        employees=by_id(Employee, {p.employee_id for p in punches if p.employee_id}),
        kiosks=by_id(KioskDevice, {p.kiosk_id for p in punches}),
        plants=by_id(Plant, {p.plant_id for p in punches}),
        snapshots=snapshots,
    )


def _employee(
    punch: Punch, related: _Related, viewer: Viewer
) -> tuple[PunchLogEmployee | None, bool]:
    employee = related.employees.get(punch.employee_id) if punch.employee_id else None
    if employee is None:
        return None, False
    if viewer.only_plant_ids is not None and employee.plant_id not in viewer.only_plant_ids:
        return None, True
    return PunchLogEmployee(
        id=employee.id, code=employee.employee_code, name=employee.full_name
    ), False


def _snapshot(punch: Punch, related: _Related, viewer: Viewer) -> PunchLogSnapshot:
    snapshot = related.snapshots.get(punch.id)
    if snapshot is None:
        return PunchLogSnapshot(state="none")
    return PunchLogSnapshot(
        state=snapshot.state,  # type: ignore[arg-type]
        is_dark=snapshot.is_dark if viewer.sees_dark_photos else None,
        expires_at=snapshot.expires_at,
        purged_at=snapshot.purged_at,
    )


def _item(punch: Punch, related: _Related, viewer: Viewer) -> PunchLogItem:
    employee, hidden = _employee(punch, related, viewer)
    plant = related.plants[punch.plant_id]
    kiosk = related.kiosks[punch.kiosk_id]
    return PunchLogItem(
        id=punch.id,
        server_received_at=punch.server_received_at,
        employee=employee,
        employee_hidden=hidden,
        plant=PunchLogPlace(id=plant.id, name=plant.name, code=plant.code),
        kiosk=PunchLogPlace(id=kiosk.id, name=kiosk.name),
        method=punch.method,
        direction=punch.direction,  # type: ignore[arg-type]
        decision=punch.decision,
        reason_codes=list(punch.reason_codes),
        snapshot=_snapshot(punch, related, viewer),
    )


def punch_items(session: Session, punches: Sequence[Punch], viewer: Viewer) -> list[PunchLogItem]:
    related = _load_related(session, punches)
    return [_item(punch, related, viewer) for punch in punches]


def punch_detail(session: Session, punch: Punch, viewer: Viewer) -> PunchDetail:
    item = punch_items(session, [punch], viewer)[0]
    location = (
        PunchLocation(
            lat=float(punch.lat),
            lon=float(punch.lon),
            accuracy_m=float(punch.accuracy_m) if punch.accuracy_m is not None else None,
        )
        if punch.lat is not None and punch.lon is not None
        else None
    )
    return PunchDetail(
        **item.model_dump(),
        app_version=punch.app_version,
        device_time=punch.device_claimed_at,
        location=location,
    )
