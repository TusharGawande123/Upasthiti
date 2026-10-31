"""Speed and memory of the biggest report (M5 spec S-42): the monthly register of the whole company
(7 plants, 650 people, 31 days of attendance). Excel in under 20 s, one plant as PDF in under 30 s,
Python memory peak under 450 MB (Render Free has 512 MB). Real PostgreSQL; fake people (Faker)."""

import time
import tracemalloc
from datetime import date, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import insert, select
from sqlalchemy.orm import Session

from app.core.time import utc_now
from app.modules.attendance.compute import ATTENDANCE_CALC_VERSION
from app.modules.attendance.models import AttendanceDay
from app.modules.employees.models import Employee
from app.modules.users.models import Role
from app.scripts.make_fake_data import make_fake_data
from tests.clock_helpers import frozen_at, ist
from tests.people_helpers import client_for

NOW = ist(date(2026, 11, 2), 12, 0)
EXCEL_SECONDS, PDF_SECONDS, MEMORY_MB = 20, 30, 450
PARAMS = {"month": "2026-10", "include_demo": "true"}


@pytest.fixture
def company(db_session: Session):
    """650 fake people with a counted present day for every day of October 2026."""
    with frozen_at(NOW):
        make_fake_data(db_session)
        people = list(db_session.execute(select(Employee.id, Employee.plant_id, Employee.type)))
        stamp = utc_now()
        rows = []
        for day_number in range(31):
            day = date(2026, 10, 1) + timedelta(days=day_number)
            for employee_id, plant_id, kind in people:
                rows.append(
                    {
                        "employee_id": employee_id,
                        "attendance_date": day,
                        "plant_id": plant_id,
                        "employee_type": kind,
                        "day_kind": "working",
                        "status": "present",
                        "first_in": datetime.combine(day, datetime.min.time(), tzinfo=stamp.tzinfo),
                        "worked_min": 480,
                        "payable_min": 480,
                        # A temporary worker has hours only, no status minutes (a table check).
                        "status_min": None if kind == "temporary" else 480,
                        "shift_length_min": 480,
                        "calc_version": ATTENDANCE_CALC_VERSION,
                        "stale": False,
                        "computed_at": stamp,
                    }
                )
        db_session.execute(insert(AttendanceDay), rows)
        db_session.commit()
        yield db_session


def login(db_app: FastAPI, session: Session) -> TestClient:
    with frozen_at(NOW):
        return client_for(db_app, session, Role.SUPER_ADMIN, "boss")


def test_the_company_register_in_excel_is_fast_and_small(db_app: FastAPI, company: Session) -> None:
    boss = login(db_app, company)
    with frozen_at(NOW):
        tracemalloc.start()
        started = time.perf_counter()
        response = boss.get("/api/v1/reports/register.xlsx", params=PARAMS)
        seconds = time.perf_counter() - started
        _, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()

    assert response.status_code == 200, response.text[:300]
    assert len(response.content) > 100_000
    assert seconds < EXCEL_SECONDS, f"Excel took {seconds:.1f} s"
    assert peak / 1_000_000 < MEMORY_MB, f"memory peak {peak / 1_000_000:.0f} MB"


def test_one_plant_register_as_pdf_is_fast(db_app: FastAPI, company: Session) -> None:
    boss = login(db_app, company)
    plant_id = company.scalars(select(Employee.plant_id)).first()
    with frozen_at(NOW):
        started = time.perf_counter()
        response = boss.get(
            "/api/v1/reports/register.pdf", params=PARAMS | {"plant_id": str(plant_id)}
        )
        seconds = time.perf_counter() - started

    assert response.status_code == 200, response.text[:300]
    assert response.content.startswith(b"%PDF")
    assert seconds < PDF_SECONDS, f"PDF took {seconds:.1f} s"
