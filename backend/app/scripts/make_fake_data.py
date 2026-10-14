"""Fills a DEVELOPMENT database with fake data (spec S-15):

    uv run python -m app.scripts.make_fake_data

Creates the 7 client plants, a few contractors and departments, and exactly 650 fake
employees spread over all plants (300 permanent, 350 temporary). All names and codes are
invented (Faker); the repository is public, so real people are never used.

It refuses to run in production, and refuses when employees already exist.
"""

import random
import sys
from datetime import timedelta
from decimal import Decimal

from faker import Faker
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import load_settings_or_exit
from app.core.db import get_session_factory
from app.core.time import today_ist
from app.modules.audit.service import SYSTEM_ACTOR
from app.modules.contractors.models import Contractor
from app.modules.employees.models import Employee
from app.modules.employees.operations import AuditContext, create_employee
from app.modules.employees.rules import EmployeeValues, default_punch_method
from app.modules.org.models import Department, EmployeeCategory, Plant, Shift
from app.modules.org.plants_service import add_client_plants

PERMANENT_TOTAL = 300
TEMPORARY_TOTAL = 350
SEED = 2026  # the same fake people every time
CONTRACTOR_NAMES = (
    "Shree Manpower",
    "Om Sai Staffing",
    "Gajanan Labour Supply",
    "Jai Hind Workforce",
)
DEPARTMENT_NAMES = ("Press shop", "Cutting", "Dispatch", "Quality", "Stores")


def spread(total: int, parts: int) -> list[int]:
    """Split `total` into `parts` nearly equal numbers (the first ones get the remainder)."""
    base, extra = divmod(total, parts)
    return [base + (1 if index < extra else 0) for index in range(parts)]


def make_fake_data(session: Session) -> dict[str, int]:
    if session.scalar(select(func.count()).select_from(Employee)):
        raise SystemExit("Employees already exist; use an empty database.")
    fake = Faker("en_IN")
    Faker.seed(SEED)
    randomizer = random.Random(SEED)  # noqa: S311 (fake data, not security)

    add_client_plants(session, actor=SYSTEM_ACTOR)
    plants = list(session.scalars(select(Plant).order_by(Plant.code)))
    contractors = [Contractor(name=name) for name in CONTRACTOR_NAMES]
    session.add_all(contractors)
    for plant in plants:
        session.add_all(Department(plant_id=plant.id, name=name) for name in DEPARTMENT_NAMES)
    session.flush()

    context = AuditContext(SYSTEM_ACTOR)
    next_code = 1001
    permanent_per_plant = spread(PERMANENT_TOTAL, len(plants))
    temporary_per_plant = spread(TEMPORARY_TOTAL, len(plants))
    for plant, permanent_count, temporary_count in zip(
        plants, permanent_per_plant, temporary_per_plant, strict=True
    ):
        shift = session.scalars(select(Shift).where(Shift.plant_id == plant.id)).first()
        categories = {
            category.name: category
            for category in session.scalars(
                select(EmployeeCategory).where(EmployeeCategory.plant_id == plant.id)
            )
        }
        departments = list(
            session.scalars(select(Department).where(Department.plant_id == plant.id))
        )
        if shift is None:
            raise SystemExit(f"Plant {plant.code} has no shift.")

        for kind, count in (("permanent", permanent_count), ("temporary", temporary_count)):
            for _ in range(count):
                is_temporary = kind == "temporary"
                category_name = (
                    randomizer.choice(("Operator", "Helper", "Worker"))
                    if is_temporary
                    else randomizer.choice(("Staff", "Operator", "Worker"))
                )
                create_employee(
                    session,
                    context,
                    EmployeeValues(
                        employee_code=str(next_code),
                        full_name=fake.name(),
                        type=kind,
                        plant_id=plant.id,
                        category_id=categories[category_name].id,
                        department_id=randomizer.choice(departments).id,
                        shift_id=shift.id,
                        contractor_id=randomizer.choice(contractors).id if is_temporary else None,
                        punch_method=default_punch_method(kind),
                        hourly_rate=Decimal(randomizer.randrange(60, 130))
                        if is_temporary
                        else None,
                        ot_rate_per_hour=Decimal(randomizer.randrange(90, 200)),
                        joined_on=today_ist() - timedelta(days=randomizer.randrange(30, 900)),
                    ),
                )
                next_code += 1
    session.commit()
    return {"plants": len(plants), "employees": next_code - 1001}


def main() -> int:
    settings = load_settings_or_exit()
    if settings.is_production:
        print("Refused: this command never runs in production.")
        return 1
    with get_session_factory()() as session:
        make_fake_data(session)
    # The totals are fixed constants, so nothing about the (fake) people is printed.
    print(f"Done: 7 plants and {PERMANENT_TOTAL + TEMPORARY_TOTAL} fake employees.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
