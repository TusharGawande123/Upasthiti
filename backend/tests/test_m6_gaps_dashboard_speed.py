"""M6 gap test for M5 AC-27: the live dashboard of 650 fake people with a day of punches answers one
plant in under 2 s and all plants in under 10 s (M5 AC-27, lead decision of
2026-11-06). Real PostgreSQL, fake people (Faker), the clock pinned to Fri 30/10/2026 10:00 IST."""

import time
import uuid
from collections.abc import Iterator
from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.modules.employees.models import Employee
from app.modules.kiosks.models import KioskDevice
from app.modules.org.models import Plant
from app.modules.punches.models import Punch
from app.modules.users.models import Role
from app.scripts.make_fake_data import make_fake_data
from tests.clock_helpers import frozen_at, ist
from tests.kiosk_helpers import Device
from tests.people_helpers import client_for

pytestmark = pytest.mark.time_sensitive

FRIDAY = date(2026, 10, 30)
NOW = ist(FRIDAY, 10, 0)
# M5 AC-27 as decided by the lead on 2026-11-06. Measured before the query reduction: about 133
# queries and 1.1 s for one plant, 5.7 s for all seven on a busy laptop.
ONE_PLANT_SECONDS, ALL_PLANTS_SECONDS = 2.0, 10.0
TRIES = 3  # the best of three: a busy laptop or CI machine must not fail a correct answer


@pytest.fixture(autouse=True)
def pinned_clock() -> Iterator[None]:
    with frozen_at(NOW):
        yield


@pytest.fixture
def company(db_session: Session) -> Session:
    """650 fake people; nine in ten of them punched IN this morning, a few already OUT."""
    make_fake_data(db_session)
    db_session.execute(update(Plant).values(attendance_start_date=date(2026, 10, 26)))
    kiosks: dict[uuid.UUID, KioskDevice] = {}
    for plant_id in db_session.scalars(select(Plant.id).order_by(Plant.code)):
        kiosk = KioskDevice(
            plant_id=plant_id, name="Main gate", status="active", public_key=Device().public_key
        )
        db_session.add(kiosk)
        kiosks[plant_id] = kiosk
    db_session.flush()
    people = db_session.execute(
        select(Employee.id, Employee.plant_id).order_by(Employee.employee_code)
    ).all()
    for number, (employee_id, plant_id) in enumerate(people):
        if number % 10 == 9:
            continue  # not here yet
        kiosk = kiosks[plant_id]
        for direction, hour, minute in (("in", 7, number % 50), ("out", 9, 30)):
            if direction == "out" and number % 7:
                continue
            db_session.add(
                Punch(
                    client_punch_id=uuid.uuid4(),
                    kiosk_id=kiosk.id,
                    plant_id=plant_id,
                    employee_id=employee_id,
                    method="face",
                    direction=direction,
                    decision="accepted",
                    reason_codes=[],
                    server_received_at=ist(FRIDAY, hour, minute),
                    was_offline=False,
                )
            )
    db_session.commit()
    return db_session


def fastest_answer(client: TestClient, **params: str) -> tuple[float, dict]:
    best = float("inf")
    body: dict = {}
    for _ in range(TRIES):
        started = time.perf_counter()
        response = client.get("/api/v1/dashboard/live", params=params)
        best = min(best, time.perf_counter() - started)
        assert response.status_code == 200, response.text
        body = response.json()
    return best, body


def test_the_live_answer_is_fast_for_650_people(db_app: FastAPI, company: Session) -> None:
    boss = client_for(db_app, company, Role.SUPER_ADMIN, "boss")
    one_plant = company.scalars(select(Plant).order_by(Plant.code)).first()
    assert one_plant is not None

    one_seconds, one_body = fastest_answer(boss, plant_id=str(one_plant.id))
    all_seconds, all_body = fastest_answer(boss)

    assert len(all_body["plants"]) == 7 and len(one_body["plants"]) == 1
    assert sum(item["arrived"] for item in all_body["plants"]) > 500
    assert one_seconds < ONE_PLANT_SECONDS, f"one plant took {one_seconds:.2f} s"
    assert all_seconds < ALL_PLANTS_SECONDS, f"all plants took {all_seconds:.2f} s"
