"""What is still missing before plants can take attendance.

- Setup wizard (F-5): five company-wide steps, worked out from the data, so nothing extra is
  stored. A step is done when at least one active plant has it.
- Readiness card (F-17): the same checks for one plant.

"""

import uuid
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.employees.models import Employee, EmployeeStatus
from app.modules.kiosks.models import KioskDevice, KioskStatus
from app.modules.org.models import EmployeeCategory, Geofence, Plant, Shift


@dataclass(frozen=True)
class PlantReadiness:
    plant_id: uuid.UUID
    geofence: bool
    active_shifts: int
    active_categories: int
    active_kiosks: int
    active_employees: int

    @property
    def ready(self) -> bool:
        return (
            self.geofence
            and self.active_shifts > 0
            and self.active_categories > 0
            and self.active_kiosks > 0
            and self.active_employees > 0
        )


@dataclass(frozen=True)
class SetupStep:
    key: str  # plants | geofence | shifts_and_categories | kiosk | employees
    done: bool


def plant_readiness(session: Session, plant_id: uuid.UUID) -> PlantReadiness:
    return PlantReadiness(
        plant_id=plant_id,
        geofence=_has_geofence(session, plant_id),
        active_shifts=_count_active(session, Shift, plant_id),
        active_categories=_count_active(session, EmployeeCategory, plant_id),
        active_kiosks=count_active_kiosks(session, plant_id),
        active_employees=count_active_employees(session, plant_id),
    )


def setup_status(session: Session) -> list[SetupStep]:
    active_plant_ids = list(session.scalars(select(Plant.id).where(Plant.is_active.is_(True))))
    readiness = [plant_readiness(session, plant_id) for plant_id in active_plant_ids]
    return [
        SetupStep("plants", bool(active_plant_ids)),
        SetupStep("geofence", any(item.geofence for item in readiness)),
        SetupStep(
            "shifts_and_categories",
            any(item.active_shifts and item.active_categories for item in readiness),
        ),
        SetupStep("kiosk", any(item.active_kiosks for item in readiness)),
        SetupStep("employees", any(item.active_employees for item in readiness)),
    ]


def count_active_kiosks(session: Session, plant_id: uuid.UUID) -> int:
    return (
        session.scalar(
            select(func.count())
            .select_from(KioskDevice)
            .where(KioskDevice.plant_id == plant_id, KioskDevice.status == KioskStatus.ACTIVE.value)
        )
        or 0
    )


def count_active_employees(session: Session, plant_id: uuid.UUID) -> int:
    return (
        session.scalar(
            select(func.count())
            .select_from(Employee)
            .where(Employee.plant_id == plant_id, Employee.status == EmployeeStatus.ACTIVE.value)
        )
        or 0
    )


def _has_geofence(session: Session, plant_id: uuid.UUID) -> bool:
    return (
        session.scalar(
            select(Geofence.id).where(Geofence.plant_id == plant_id, Geofence.is_current.is_(True))
        )
        is not None
    )


def _count_active(
    session: Session, model: type[Shift] | type[EmployeeCategory], plant_id: uuid.UUID
) -> int:
    return (
        session.scalar(
            select(func.count())
            .select_from(model)
            .where(model.plant_id == plant_id, model.is_active.is_(True))
        )
        or 0
    )
