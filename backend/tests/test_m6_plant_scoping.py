"""M6 AC-M6-10: a Plant Head who asks for anything of another plant gets 403 or 404 and no data.

Two plants are made; the Plant Head belongs to plant A, and every record of plant B carries a
marker text. Every read route that takes a plant, employee, device or shift id is called with
the ids of plant B, and every list is asked for plant B. No answer may hold a marker.
"""

import uuid

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.users.models import Role, User
from app.modules.users.plant_access import set_user_plant
from tests.kiosk_helpers import Device, make_active_kiosk
from tests.people_helpers import PlantIds, client_for, create_plant, permanent_body
from tests.role_matrix import ROUTE_AUDIENCE, Audience
from tests.test_m6_role_matrix import concrete_path

MARKER_NAME = "Zubin Bhosale"
MARKER_CODE = "BMARK-77"
MARKER_DEVICE = "Gate-of-plant-B"
# Query values some routes require, so a 422 cannot stand in for the scope answer.
REQUIRED_QUERY = (
    "?month=2026-10&code=123456&date=2026-10-28&date_from=2026-10-01&date_to=2026-10-07"
)
# The audiences a Plant Head can reach; the others answer 403 before any scope question.
PLANT_HEAD_AUDIENCES = (Audience.ALL_ADMINS, Audience.ANY_ADMIN, Audience.SUPER_PLANT)


class TwoPlants:
    """The Plant Head of plant A, and the ids and markers of plant B."""

    def __init__(self, app: FastAPI, session: Session) -> None:
        boss = client_for(app, session, Role.SUPER_ADMIN, "boss")
        self.plant_a = create_plant(boss, session, "K134")
        self.plant_b = create_plant(boss, session, "K135")
        created = boss.post(
            "/api/v1/employees",
            json=permanent_body(self.plant_b, code=MARKER_CODE, name=MARKER_NAME),
        )
        assert created.status_code == 201, created.text
        self.employee_b_id = created.json()["id"]
        self.kiosk_b_id = str(make_active_kiosk(session, self.plant_b, Device(), MARKER_DEVICE).id)
        self.head = client_for(app, session, Role.PLANT_HEAD, "head-a")
        head_user = session.scalars(select(User).where(User.username == "head-a")).one()
        set_user_plant(session, head_user, uuid.UUID(self.plant_a.id))
        session.commit()

    def ids_of_plant_b(self) -> dict[str, str]:
        plant: PlantIds = self.plant_b
        return {
            "plant_id": plant.id,
            "employee_id": self.employee_b_id,
            "kiosk_id": self.kiosk_b_id,
            "shift_id": plant.shift_id,
        }


def leaks_plant_b(text: str) -> bool:
    return MARKER_NAME in text or MARKER_CODE in text or MARKER_DEVICE in text


def path_with_ids_of_plant_b(path_format: str, ids: dict[str, str]) -> str | None:
    """The path with the plant B ids, or None when no parameter of the path is one of them."""
    path = path_format
    used = False
    for name, value in ids.items():
        if "{" + name + "}" in path:
            path = path.replace("{" + name + "}", value)
            used = True
    return concrete_path(path) + REQUIRED_QUERY if used else None


def test_plant_head_reads_nothing_of_another_plant_by_id(
    db_app: FastAPI, db_session: Session
) -> None:
    """M6 AC-M6-10: every read route with a plant, employee, device or shift id of plant B."""
    world = TwoPlants(db_app, db_session)
    ids = world.ids_of_plant_b()

    swept = 0
    wrong = []
    for (method, path_format), audience in sorted(ROUTE_AUDIENCE.items()):
        path = path_with_ids_of_plant_b(path_format, ids)
        if method != "GET" or audience not in PLANT_HEAD_AUDIENCES or path is None:
            continue
        swept += 1
        answer = world.head.get(path)
        if answer.status_code not in (403, 404) or leaks_plant_b(answer.text):
            wrong.append((path_format, answer.status_code))
    assert swept >= 15, "the sweep must reach the id routes"
    assert wrong == []


def test_plant_head_lists_of_plant_b_are_refused_or_empty(
    db_app: FastAPI, db_session: Session
) -> None:
    """M6 AC-M6-10: every list that can be narrowed to a plant, asked for plant B."""
    world = TwoPlants(db_app, db_session)
    plant_b = world.plant_b.id
    asked = [
        f"/api/v1/employees?plant_id={plant_b}",
        f"/api/v1/employees?q={MARKER_CODE}",
        f"/api/v1/kiosks?plant_id={plant_b}",
        f"/api/v1/punches?plant_id={plant_b}",
        f"/api/v1/punches/summary?plant_id={plant_b}",
        f"/api/v1/dashboard/live?plant_id={plant_b}",
        f"/api/v1/attendance/daily?plant_id={plant_b}&date=2026-10-28",
        f"/api/v1/attendance/register?plant_id={plant_b}&month=2026-10",
        f"/api/v1/attendance/undecided?plant_id={plant_b}",
        f"/api/v1/muster?plant_id={plant_b}&date=2026-10-28",
        f"/api/v1/notices?plant_id={plant_b}",
        f"/api/v1/holidays?plant_id={plant_b}",
        f"/api/v1/leave?plant_id={plant_b}",
        f"/api/v1/regularisations?plant_id={plant_b}",
        f"/api/v1/insights/punctuality?plant_id={plant_b}",
        f"/api/v1/search?q={MARKER_NAME.split()[0]}",
        f"/api/v1/search?q={MARKER_CODE}",
        f"/api/v1/audit?q={MARKER_CODE}",
    ]
    wrong = []
    for url in asked:
        answer = world.head.get(url)
        if answer.status_code >= 500 or leaks_plant_b(answer.text):
            wrong.append((url, answer.status_code))
    assert wrong == []


def test_plant_head_cannot_change_a_device_of_plant_b(db_app: FastAPI, db_session: Session) -> None:
    """M6 AC-M6-10: the writes a Plant Head has (devices) refuse a device of another plant."""
    world = TwoPlants(db_app, db_session)
    kiosk_url = f"/api/v1/kiosks/{world.kiosk_b_id}"

    answers = [
        world.head.patch(kiosk_url, json={"name": "Hijacked"}),
        world.head.post(f"{kiosk_url}/pairing-code"),
        world.head.post(f"{kiosk_url}/revoke", json={"reason": "Not my plant"}),
        world.head.post("/api/v1/kiosks", json={"plant_id": world.plant_b.id, "name": "Mine now"}),
        world.head.get(f"/api/v1/plants/{world.plant_b.id}/gate-poster.pdf"),
    ]
    assert [answer.status_code for answer in answers] == [404, 404, 404, 404, 404]


def test_plant_head_cannot_correct_an_employee_of_plant_b(
    db_app: FastAPI, db_session: Session
) -> None:
    """M6 AC-M6-10: a correction request for an employee of another plant is refused."""
    world = TwoPlants(db_app, db_session)

    answer = world.head.post(
        "/api/v1/regularisations",
        json={
            "employee_id": world.employee_b_id,
            "attendance_date": "2026-10-28",
            "kind": "set_status",
            "status_value": "present",
            "reason": "Forgot to punch",
        },
    )

    assert answer.status_code in (403, 404)
    assert not leaks_plant_b(answer.text)


def test_the_head_is_really_scoped_to_plant_a(db_app: FastAPI, db_session: Session) -> None:
    """Control for the tests above: the same Plant Head does see his own plant."""
    world = TwoPlants(db_app, db_session)

    own = world.head.get(f"/api/v1/plants/{world.plant_a.id}")
    other = world.head.get(f"/api/v1/plants/{world.plant_b.id}")

    assert own.status_code == 200
    assert other.status_code in (403, 404)
    assert isinstance(world.head, TestClient)
