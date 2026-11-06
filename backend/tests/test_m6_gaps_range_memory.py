"""M6 gap test for M5c AC-5: the Excel register of one year for 300 people is built in batches and
its Python memory peak stays under 450 MB (Render Free has 512 MB). Real PostgreSQL, fake people."""

import tracemalloc
import uuid
from datetime import date, datetime, timedelta

import pytest
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.time import utc_now
from app.modules.attendance.compute import ATTENDANCE_CALC_VERSION
from app.modules.attendance.models import AttendanceDay
from app.modules.audit.service import SYSTEM_ACTOR
from app.modules.employees.models import Employee
from app.modules.employees.operations import AuditContext, create_employee
from app.modules.employees.rules import EmployeeValues
from app.modules.users.models import Role
from tests.clock_helpers import frozen_at, ist
from tests.people_helpers import client_for, create_plant

pytestmark = pytest.mark.time_sensitive

NOW = ist(date(2026, 11, 2), 12, 0)
PEOPLE = 300
FIRST_DAY = date(2025, 11, 3)  # 366 days up to and including 02/11/2026
MEMORY_MB = 450


def test_a_year_of_300_people_in_excel_stays_under_the_memory_limit(
    db_app: FastAPI, db_session: Session
) -> None:
    """M5c AC-5: 300 people x 366 days as one Excel file, peak memory under 450 MB."""
    with frozen_at(NOW):
        boss = client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")
        plant = create_plant(boss, db_session, "K134")
        boss.patch(f"/api/v1/plants/{plant.id}", json={"attendance_start_date": "2025-10-01"})
        context = AuditContext(SYSTEM_ACTOR)
        for number in range(PEOPLE):
            create_employee(
                db_session,
                context,
                EmployeeValues(
                    employee_code=f"M{number + 1:04d}",
                    full_name=f"Fake Person {number + 1}",
                    type="permanent",
                    plant_id=uuid.UUID(plant.id),
                    category_id=uuid.UUID(plant.staff_id),
                    department_id=None,
                    shift_id=uuid.UUID(plant.shift_id),
                    contractor_id=None,
                    punch_method="face",
                    hourly_rate=None,
                    ot_rate_per_hour=None,
                    joined_on=date(2025, 10, 1),
                ),
            )
        db_session.commit()
        stamp = utc_now()
        people = list(db_session.execute(select(Employee.id)).scalars())
        # Creating a person already marked some days to be calculated: those rows are overwritten.
        new_days = insert(AttendanceDay)
        write_days = new_days.on_conflict_do_update(
            index_elements=["employee_id", "attendance_date"],
            set_={
                name: new_days.excluded[name]
                for name in (
                    "plant_id",
                    "employee_type",
                    "day_kind",
                    "status",
                    "first_in",
                    "worked_min",
                    "payable_min",
                    "status_min",
                    "shift_length_min",
                    "calc_version",
                    "stale",
                    "computed_at",
                )
            },
        )
        for day_number in range(366):
            day = FIRST_DAY + timedelta(days=day_number)
            db_session.execute(
                write_days,
                [
                    {
                        "employee_id": employee_id,
                        "attendance_date": day,
                        "plant_id": uuid.UUID(plant.id),
                        "employee_type": "permanent",
                        "day_kind": "working",
                        "status": "present",
                        "first_in": datetime.combine(day, datetime.min.time(), tzinfo=stamp.tzinfo),
                        "worked_min": 480,
                        "payable_min": 480,
                        "status_min": 480,
                        "shift_length_min": 480,
                        "calc_version": ATTENDANCE_CALC_VERSION,
                        "stale": False,
                        "computed_at": stamp,
                    }
                    for employee_id in people
                ],
            )
        db_session.commit()

        tracemalloc.start()
        response = boss.get(
            "/api/v1/reports/register-range.xlsx",
            params={
                "plant_id": plant.id,
                "date_from": FIRST_DAY.isoformat(),
                "date_to": "2026-11-02",
            },
        )
        _, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()

    assert response.status_code == 200, response.text[:300]
    assert len(response.content) > 100_000
    assert peak / 1_000_000 < MEMORY_MB, f"memory peak {peak / 1_000_000:.0f} MB"
