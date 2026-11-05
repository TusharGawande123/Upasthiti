"""Inside now, the muster and the alerts with phone punches (M4b spec §7 rule 22; M5 spec §7 rules
17, 19, 29 as amended; AC-41, AC-41b). Real PostgreSQL, fake data, the clock pinned to Monday
02/11/2026. K134 is the home plant, K200 another plant of the company with its own fence.
The phone punches are written straight as rows (the punch pipeline has its own tests)."""

import uuid
from collections.abc import Iterator
from datetime import date, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.attendance.models import AttendanceDay
from app.modules.notifications.alerts import run_five_minute_alerts
from app.modules.notifications.models import Notification
from app.modules.org.models import Geofence, PlantWeeklyOff
from app.modules.phone.models import PhoneSession
from app.modules.punches.models import Punch
from app.modules.users.models import Role, User
from app.modules.users.plant_access import set_user_plant
from tests.clock_helpers import frozen_at, ist
from tests.kiosk_helpers import Device, make_active_kiosk
from tests.people_helpers import PlantIds, client_for, create_plant, permanent_body
from tests.phone_helpers import make_phone_punch, make_phone_session

pytestmark = pytest.mark.time_sensitive

MONDAY = date(2026, 11, 2)


def make_plant(boss: TestClient, session: Session, code: str, centre: float) -> PlantIds:
    plant = create_plant(boss, session, code)
    boss.patch(f"/api/v1/plants/{plant.id}", json={"attendance_start_date": "2026-10-26"})
    session.add(
        PlantWeeklyOff(
            plant_id=uuid.UUID(plant.id),
            weekday=7,
            effective_from=date(2026, 10, 1),
            created_at=ist(date(2026, 10, 1), 12),
        )
    )
    session.add(
        Geofence(
            plant_id=uuid.UUID(plant.id),
            version=1,
            shape="circle",
            geojson={"type": "Point", "coordinates": [75.25 + centre, 19.85 + centre]},
            radius_m=200,
            buffer_m=25,
            is_current=True,
        )
    )
    session.commit()
    return plant


@pytest.fixture(autouse=True)
def pinned_clock() -> Iterator[None]:
    with frozen_at(ist(MONDAY, 9, 0)):
        yield


@pytest.fixture
def world(db_app: FastAPI, db_session: Session) -> dict:
    boss = client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")
    k134 = make_plant(boss, db_session, "K134", 0.0)
    k200 = make_plant(boss, db_session, "K200", 0.05)
    people = {}
    for code in ("F-201", "P-2"):
        body = permanent_body(k134, code=code, name=f"Person {code}") | {"joined_on": "2026-10-26"}
        people[code] = uuid.UUID(boss.post("/api/v1/employees", json=body).json()["id"])
    gate134, gate200 = Device(), Device()
    kiosk134 = make_active_kiosk(db_session, k134, gate134)
    kiosk200 = make_active_kiosk(db_session, k200, gate200)
    heads = {}
    for username, plant in (("head134", k134), ("head200", k200)):
        heads[username] = client_for(db_app, db_session, Role.PLANT_HEAD, username)
        user = db_session.scalars(select(User).where(User.username == username)).one()
        set_user_plant(db_session, user, uuid.UUID(plant.id))
    db_session.commit()
    return {
        "boss": boss,
        "heads": heads,
        "k134": k134,
        "k200": k200,
        "people": people,
        "devices": {"k134": (kiosk134, gate134), "k200": (kiosk200, gate200)},
        "session": db_session,
    }


def phone_session_of(world: dict, code: str) -> PhoneSession:
    return make_phone_session(world["session"], world["people"][code], ist(MONDAY, 6, 0))


def visit_in(world: dict, code: str, moment: datetime, **changes: object) -> Punch:
    """A phone IN of a K134 person inside K200's fence (outside work): accepted, no flag."""
    return make_phone_punch(
        world["session"],
        phone_session_of(world, code),
        uuid.UUID(world["k134"].id),
        moment,
        location_plant_id=uuid.UUID(world["k200"].id),
        direction="in",
        **changes,
    )


def outside_in(world: dict, code: str, moment: datetime, direction: str = "in") -> Punch:
    """A phone punch inside no fence: flagged OUTSIDE_PLANT, `location_plant_id` empty."""
    return make_phone_punch(
        world["session"],
        phone_session_of(world, code),
        uuid.UUID(world["k134"].id),
        moment,
        location_plant_id=None,
        decision="flagged",
        reason_codes=["OUTSIDE_PLANT"],
        direction=direction,
    )


def gate_in(world: dict, code: str, moment: datetime, plant: str = "k134") -> None:
    kiosk = world["devices"][plant][0]
    world["session"].add(
        Punch(
            client_punch_id=uuid.uuid4(),
            kiosk_id=kiosk.id,
            plant_id=kiosk.plant_id,
            employee_id=world["people"][code],
            method="face",
            direction="in",
            decision="accepted",
            reason_codes=[],
            server_received_at=moment,
        )
    )
    world["session"].flush()


def live(client: TestClient, **params: str) -> dict:
    answer = client.get("/api/v1/dashboard/live", params=params)
    assert answer.status_code == 200, answer.text
    return answer.json()


def numbers(body: dict, code: str) -> dict:
    return next(item for item in body["plants"] if item["plant"]["code"] == code)


def muster_codes(client: TestClient, plant_id: str) -> list[str]:
    body = client.get("/api/v1/muster", params={"plant_id": plant_id}).json()
    return [person["employee"]["code"] for plant in body["plants"] for person in plant["people"]]


# --- AC-41b: a visitor is inside where they stand ---


def test_ac_41b_a_visitor_counts_at_the_plant_where_they_stand_with_the_home_plant_shown(
    world: dict,
) -> None:
    visit_in(world, "F-201", ist(MONDAY, 8, 0))
    world["session"].commit()
    boss: TestClient = world["boss"]

    body = live(boss, plant_id=world["k200"].id)
    home = live(boss, plant_id=world["k134"].id)
    musters = boss.get("/api/v1/muster", params={"plant_id": world["k200"].id}).json()
    pdf = boss.get("/api/v1/muster.pdf", params={"plant_id": world["k200"].id})

    assert numbers(body, "K200")["inside_now"] == 1
    assert numbers(home, "K134")["inside_now"] == 0
    (person,) = musters["plants"][0]["people"]
    assert person["employee"]["code"] == "F-201"
    assert person["home_plant"] == {"code": "K134", "name": "Plant K134"}
    assert person["kiosk"] is None  # a phone punch has no gate device
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")


def test_ac_41b_the_plant_heads_see_the_visitor_only_at_the_plant_where_they_stand(
    world: dict,
) -> None:
    visit_in(world, "F-201", ist(MONDAY, 8, 0))
    world["session"].commit()

    at_k200 = muster_codes(world["heads"]["head200"], world["k200"].id)
    at_home = muster_codes(world["heads"]["head134"], world["k134"].id)

    assert at_k200 == ["F-201"] and at_home == []


def test_ac_41b_the_gate_count_of_the_visited_plant_includes_the_visitor(world: dict) -> None:
    visit_in(world, "F-201", ist(MONDAY, 8, 0))
    world["session"].commit()
    kiosk, device = world["devices"]["k200"]
    home_kiosk, home_device = world["devices"]["k134"]
    client = TestClient(world["boss"].app, headers={"Origin": "http://testserver"})

    def count(gate_device: Device, path: str = "/api/v1/kiosk/me") -> int | None:
        return client.get(path, headers=gate_device.headers("GET", path, b"")).json()["inside_now"]

    assert count(device) == 1
    assert count(home_device) == 0
    assert kiosk.id != home_kiosk.id


def test_ac_41b_the_attendance_day_stays_with_the_home_plant(world: dict) -> None:
    visit_in(world, "F-201", ist(MONDAY, 8, 0))
    world["session"].commit()
    boss: TestClient = world["boss"]

    home = boss.get(
        "/api/v1/attendance/daily", params={"date": "2026-11-02", "plant_id": world["k134"].id}
    )
    away = boss.get(
        "/api/v1/attendance/daily", params={"date": "2026-11-02", "plant_id": world["k200"].id}
    )

    codes = [item["employee"]["code"] for item in home.json()["items"]]
    assert "F-201" in codes and away.json()["items"] == []
    days = (
        world["session"]
        .scalars(select(AttendanceDay).where(AttendanceDay.employee_id == world["people"]["F-201"]))
        .all()
    )
    assert {str(day.plant_id) for day in days} == {world["k134"].id}


def test_a_visitor_who_has_left_is_not_inside_any_more(world: dict) -> None:
    visit_in(world, "F-201", ist(MONDAY, 8, 0))
    make_phone_punch(
        world["session"],
        phone_session_of(world, "F-201"),
        uuid.UUID(world["k134"].id),
        ist(MONDAY, 8, 30),
        location_plant_id=uuid.UUID(world["k200"].id),
        direction="out",
    )
    world["session"].commit()

    body = live(world["boss"], plant_id=world["k200"].id)

    assert numbers(body, "K200")["inside_now"] == 0


# --- AC-41: an OUTSIDE_PLANT IN is inside no plant ---


def test_ac_41_an_outside_plant_in_is_inside_no_plant_and_shows_as_on_outside_work(
    world: dict,
) -> None:
    outside_in(world, "F-201", ist(MONDAY, 8, 0))
    gate_in(world, "P-2", ist(MONDAY, 8, 5))
    world["session"].commit()
    boss: TestClient = world["boss"]
    _, device = world["devices"]["k134"]
    client = TestClient(boss.app, headers={"Origin": "http://testserver"})

    home = live(boss, plant_id=world["k134"].id)
    everything = live(boss, include_demo="false")
    codes = muster_codes(boss, world["k134"].id)
    path = "/api/v1/kiosk/me"
    gate_count = client.get(path, headers=device.headers("GET", path, b"")).json()["inside_now"]

    assert numbers(home, "K134")["inside_now"] == 1  # only P-2
    assert numbers(home, "K134")["on_outside_work"] == 1
    assert everything["totals"]["on_outside_work"] == 1 and everything["totals"]["inside_now"] == 1
    assert codes == ["P-2"]
    assert gate_count == 1  # F-201 is not counted at the gate either


def test_ac_41_the_still_inside_alert_leaves_out_the_outside_worker_and_goes_where_they_stand(
    world: dict,
) -> None:
    outside_in(world, "F-201", ist(MONDAY, 8, 0))  # on outside work: never "still inside"
    gate_in(world, "P-2", ist(MONDAY, 8, 5))  # still inside at 20:01 (shift 07:00-19:00)
    visitor = make_phone_punch(
        world["session"],
        phone_session_of(world, "P-2"),
        uuid.UUID(world["k134"].id),
        ist(MONDAY, 8, 6),
        location_plant_id=uuid.UUID(world["k200"].id),
        direction="in",
        client_punch_id=uuid.uuid4(),
    )
    world["session"].commit()
    now = ist(MONDAY, 20, 1)

    run_five_minute_alerts(world["session"], now)
    run_five_minute_alerts(world["session"], now)  # a repeat changes nothing

    alerts = list(
        world["session"].scalars(
            select(Notification)
            .where(Notification.kind == "still_inside")
            .order_by(Notification.created_at, Notification.id)
        )
    )
    assert [str(alert.plant_id) for alert in alerts] == [world["k200"].id]
    assert alerts[0].subject_ids == [world["people"]["P-2"]]  # F-201 is not in it
    assert visitor.location_plant_id is not None


# --- The many-rejections alert is about the gate device only ---


def test_refused_gate_code_punches_of_phones_do_not_count_for_the_gates_alert(world: dict) -> None:
    kiosk, _ = world["devices"]["k134"]
    session: Session = world["session"]
    now = ist(MONDAY, 11, 0)
    phone_session = phone_session_of(world, "F-201")

    def refuse(channel: str, number: int) -> None:
        extra: dict[str, object] = (
            {"phone_session_id": phone_session.id, "method": "gate_code"}
            if channel == "phone"
            else {"method": "face"}
        )
        session.add(
            Punch(
                client_punch_id=uuid.uuid4(),
                channel=channel,
                kiosk_id=kiosk.id,
                plant_id=kiosk.plant_id,
                employee_id=world["people"]["F-201"] if channel == "phone" else None,
                decision="rejected",
                reason_codes=["GATE_CODE_EXPIRED" if channel == "phone" else "SPOOF_SUSPECTED"],
                server_received_at=now - timedelta(minutes=number),
                **extra,
            )
        )

    for number in range(12):
        refuse("phone", number)
    for number in range(9):
        refuse("kiosk", number)
    session.commit()
    run_five_minute_alerts(session, now)
    assert not list(
        session.scalars(
            select(Notification)
            .where(Notification.kind == "many_rejections")
            .order_by(Notification.created_at, Notification.id)
        )
    )

    refuse("kiosk", 10)  # the tenth refusal AT THE DEVICE
    session.commit()
    run_five_minute_alerts(session, now)
    (alert,) = session.scalars(select(Notification).where(Notification.kind == "many_rejections"))
    assert alert.params["count"] == 10
