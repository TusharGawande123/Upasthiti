"""Helpers for the employee, approval and import tests: a plant with its default shift and
categories, a logged-in client per role, and a valid employee body. All data is fake."""

from dataclasses import dataclass
from datetime import date

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import today_ist
from app.modules.org.models import EmployeeCategory, Plant, Shift
from app.modules.users.models import Role
from tests.conftest import TEST_ORIGIN
from tests.factories import log_in, make_user


@dataclass
class PlantIds:
    id: str
    code: str
    shift_id: str
    staff_id: str
    helper_id: str


def create_plant(client: TestClient, session: Session, code: str) -> PlantIds:
    response = client.post("/api/v1/plants", json={"name": f"Plant {code}", "code": code})
    assert response.status_code == 201, response.text
    plant_id = response.json()["id"]
    plant = session.get(Plant, plant_id)
    assert plant is not None
    shift = session.scalars(select(Shift).where(Shift.plant_id == plant.id)).one()
    categories = {
        category.name: str(category.id)
        for category in session.scalars(
            select(EmployeeCategory).where(EmployeeCategory.plant_id == plant.id)
        )
    }
    return PlantIds(plant_id, code, str(shift.id), categories["Staff"], categories["Helper"])


def client_for(app: FastAPI, session: Session, role: Role, username: str) -> TestClient:
    make_user(session, role, username=username)
    client = TestClient(app, raise_server_exceptions=False, headers={"Origin": TEST_ORIGIN})
    log_in(client, username)
    return client


def permanent_body(plant: PlantIds, code: str = "1043", name: str = "Ravi Patil") -> dict:
    return {
        "employee_code": code,
        "full_name": name,
        "type": "permanent",
        "plant_id": plant.id,
        "category_id": plant.staff_id,
        "shift_id": plant.shift_id,
        "ot_rate_per_hour": "150.00",
        "joined_on": "2026-01-15",
    }


def temporary_body(plant: PlantIds, code: str = "T-2041", name: str = "Sunil More") -> dict:
    return {
        "employee_code": code,
        "full_name": name,
        "type": "temporary",
        "plant_id": plant.id,
        "category_id": plant.helper_id,
        "shift_id": plant.shift_id,
        "hourly_rate": "85.00",
        "joined_on": today_ist().isoformat(),
    }


def iso(day: date) -> str:
    return day.isoformat()
