"""M4b admin side (P3): the punch log with phone punches, "Needs review" with the phone filter and
the bulk confirm, the employees list filter, the audit viewer and "Cards ending soon" (spec M4b
§4.13, §5.5, §7 rules 19 and 28, §8.4; AC-39, AC-40, AC-53; F-76). Real PostgreSQL, fake data, the
clock pinned to Monday 02/11/2026 12:00 IST. The punches are written straight as rows (the punch
pipeline has its own tests). K134 is the home plant, K200 another plant of the company."""

import io
import uuid
from collections.abc import Iterator
from datetime import date, datetime

import openpyxl
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.audit.models import AuditLog
from app.modules.audit.service import Actor, record_audit
from app.modules.punches.models import Punch, PunchReview
from app.modules.users.models import Role, User
from app.modules.users.plant_access import set_user_plant
from tests.clock_helpers import frozen_at, ist
from tests.kiosk_helpers import Device, make_active_kiosk
from tests.people_helpers import client_for, create_plant, permanent_body, temporary_body
from tests.phone_api_helpers import switch_phone
from tests.phone_helpers import make_phone_punch, make_phone_session

MONDAY = date(2026, 11, 2)
DAY = MONDAY.isoformat()
OUTSIDE = ["OUTSIDE_PLANT"]


@pytest.fixture(autouse=True)
def pinned_clock() -> Iterator[None]:
    with frozen_at(ist(MONDAY, 12, 0)):
        yield


@pytest.fixture
def world(db_app: FastAPI, db_session: Session) -> dict:
    boss = client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")
    corporate = client_for(db_app, db_session, Role.CORPORATE_HEAD, "corp")
    k134 = create_plant(boss, db_session, "K134")
    k200 = create_plant(boss, db_session, "K200")
    people = {}
    for code in ("F-201", "F-202", "F-203", "F-204"):
        body = permanent_body(k134, code=code, name=f"Person {code}") | {"joined_on": "2026-10-26"}
        people[code] = uuid.UUID(boss.post("/api/v1/employees", json=body).json()["id"])
    heads = {}
    for username, plant in (("head134", k134), ("head200", k200)):
        heads[username] = client_for(db_app, db_session, Role.PLANT_HEAD, username)
        user = db_session.scalars(select(User).where(User.username == username)).one()
        set_user_plant(db_session, user, uuid.UUID(plant.id))
    db_session.commit()
    kiosk = make_active_kiosk(db_session, k134, Device())
    return {
        "boss": boss,
        "corporate": corporate,
        "heads": heads,
        "k134": k134,
        "k200": k200,
        "people": people,
        "kiosk": kiosk,
        "session": db_session,
    }


def allow_outside_work(world: dict, code: str, reason: str = "Site visit at the supplier") -> None:
    """Phone punching and outside work ON at 07:00, before the punches of the day."""
    with frozen_at(ist(MONDAY, 7, 0)):
        employee_id = str(world["people"][code])
        assert switch_phone(world["boss"], employee_id).status_code == 200
        answer = world["boss"].put(
            f"/api/v1/employees/{employee_id}/phone/outside-work",
            json={"allowed": True, "reason": reason},
        )
        assert answer.status_code == 200, answer.text


def phone_punch(world: dict, code: str, moment: datetime, **changes: object) -> Punch:
    session: Session = world["session"]
    phone = make_phone_session(session, world["people"][code], ist(MONDAY, 6, 0))
    punch = make_phone_punch(
        session, phone, uuid.UUID(world["k134"].id), moment, **({"direction": "in"} | changes)
    )
    session.commit()
    return punch


def outside_punch(world: dict, code: str, hour: int, minute: int = 0, **changes: object) -> Punch:
    values: dict[str, object] = {
        "location_plant_id": None,
        "decision": "flagged",
        "reason_codes": list(OUTSIDE),
    }
    return phone_punch(world, code, ist(MONDAY, hour, minute), **(values | changes))


def refused_punch(world: dict, code: str, hour: int) -> Punch:
    """A refused phone punch naming the signed-in employee (the P2 shape)."""
    return phone_punch(
        world,
        code,
        ist(MONDAY, hour),
        decision="rejected",
        direction=None,
        reason_codes=["OUTSIDE_GEOFENCE"],
        employee_id=None,
        claimed_employee_id=world["people"][code],
        match_mode=None,
    )


def gate_punch(world: dict, code: str, hour: int, **changes: object) -> Punch:
    session: Session = world["session"]
    kiosk = world["kiosk"]
    values: dict[str, object] = {
        "client_punch_id": uuid.uuid4(),
        "kiosk_id": kiosk.id,
        "plant_id": kiosk.plant_id,
        "employee_id": world["people"][code],
        "method": "face",
        "direction": "in",
        "decision": "accepted",
        "reason_codes": [],
        "server_received_at": ist(MONDAY, hour),
        "lat": 19.87,
        "lon": 75.32,
    }
    punch = Punch(**(values | changes))
    session.add(punch)
    session.commit()
    return punch


def log(client: TestClient, **params: str) -> list[dict]:
    answer = client.get("/api/v1/punches", params={"date": DAY, "page_size": 100, **params})
    assert answer.status_code == 200, answer.text
    return answer.json()["items"]


# --- Punch log: channel, outside plant, browser, no gate device (AC-39) ---


def test_ac_39_the_punch_log_filters_by_channel_and_shows_the_phone_fields(world: dict) -> None:
    allow_outside_work(world, "F-201")
    phone_punch(world, "F-201", ist(MONDAY, 9, 0))
    outside = outside_punch(world, "F-201", 10)
    gate_punch(world, "F-202", 9)
    boss: TestClient = world["boss"]

    everything = log(boss)
    phone_rows = log(boss, channel="phone")
    gate_rows = log(boss, channel="kiosk")
    outside_rows = log(boss, outside_plant="true")

    assert len(everything) == 3
    assert {row["channel"] for row in phone_rows} == {"phone"} and len(phone_rows) == 2
    assert [row["channel"] for row in gate_rows] == ["kiosk"]
    assert [row["id"] for row in outside_rows] == [str(outside.id)]
    row = outside_rows[0]
    assert row["outside_plant"] is True
    assert row["kiosk"] is None  # a phone face punch has no gate device
    assert row["phone_browser"] == "Chrome on Android"
    assert row["location_plant"] is None
    assert gate_rows[0]["phone_browser"] is None and gate_rows[0]["outside_plant"] is False


def test_the_log_names_the_other_plant_when_the_punch_was_inside_its_fence(world: dict) -> None:
    visit = phone_punch(
        world, "F-201", ist(MONDAY, 9, 0), location_plant_id=uuid.UUID(world["k200"].id)
    )

    (row,) = log(world["boss"], channel="phone")

    assert row["id"] == str(visit.id)
    assert row["location_plant"]["code"] == "K200"
    assert row["plant"]["code"] == "K134"


def test_ac_39_the_excel_export_has_channel_and_outside_plant_columns(world: dict) -> None:
    allow_outside_work(world, "F-201")
    outside_punch(world, "F-201", 10)
    gate_punch(world, "F-202", 9)

    answer = world["boss"].get("/api/v1/punches/export.xlsx", params={"date": DAY})

    assert answer.status_code == 200
    sheet = openpyxl.load_workbook(io.BytesIO(answer.content)).active
    assert sheet is not None
    rows = list(sheet.values)
    header = list(rows[0])
    assert header[-2:] == ["Channel", "Outside plant"]
    by_channel = {row[header.index("Channel")]: row for row in rows[1:]}
    assert set(by_channel) == {"Phone", "Attendance device"}
    assert by_channel["Phone"][-1] == "Yes" and by_channel["Phone"][5] in (None, "")
    assert by_channel["Attendance device"][-1] == "No"


def test_the_position_of_a_phone_punch_is_for_the_super_admin_only(world: dict) -> None:
    phone = outside_punch(world, "F-201", 10, accuracy_m=12)
    gate = gate_punch(world, "F-202", 9)

    seen_by_boss = world["boss"].get(f"/api/v1/punches/{phone.id}").json()
    seen_by_corporate = world["corporate"].get(f"/api/v1/punches/{phone.id}").json()
    seen_by_head = world["heads"]["head134"].get(f"/api/v1/punches/{phone.id}").json()
    gate_for_corporate = world["corporate"].get(f"/api/v1/punches/{gate.id}").json()

    assert seen_by_boss["location"]["lat"] == pytest.approx(19.87)
    assert seen_by_corporate["location"] is None and seen_by_head["location"] is None
    # How exact the reading was is not a position: everybody may see it.
    assert seen_by_corporate["location_accuracy_m"] == pytest.approx(12)
    # Gate punches keep the M4 rule (the gate device stands at the plant anyway).
    assert gate_for_corporate["location"]["lat"] == pytest.approx(19.87)


def test_the_plant_head_of_the_visited_plant_does_not_see_the_visit_in_the_log(
    world: dict,
) -> None:
    phone_punch(world, "F-201", ist(MONDAY, 9, 0), location_plant_id=uuid.UUID(world["k200"].id))

    assert log(world["heads"]["head200"]) == []
    assert len(log(world["heads"]["head134"])) == 1


# --- Needs review: flag list, phone filter, listing rule (AC-40) ---


def test_ac_40_the_phone_filter_lists_flagged_and_refused_punches_only(world: dict) -> None:
    allow_outside_work(world, "F-201")
    phone_punch(world, "F-201", ist(MONDAY, 8, 0))  # accepted inside the fence
    flagged = outside_punch(world, "F-201", 9)
    refused = refused_punch(world, "F-201", 10)
    gate_punch(world, "F-202", 9, decision="flagged", reason_codes=["LOCATION_AT_EDGE"])
    boss: TestClient = world["boss"]

    to_check = boss.get("/api/v1/reviews", params={"channel": "phone"}).json()["items"]
    rejected = boss.get("/api/v1/reviews", params={"channel": "phone", "tab": "rejected"}).json()[
        "items"
    ]
    all_phone = log(boss, channel="phone")

    assert [item["punch"]["id"] for item in to_check] == [str(flagged.id)]
    assert [item["punch"]["id"] for item in rejected] == [str(refused.id)]
    assert len(all_phone) == 3  # all three are in the punch log under "Phone"
    codes = {code for row in all_phone for code in row["reason_codes"]}
    assert not any(code.startswith("PHONE_PUNCH") for code in codes)
    assert rejected[0]["approvable"] is True  # names the signed-in employee


def test_a_refused_phone_punch_that_names_nobody_is_not_listed(world: dict) -> None:
    nameless = phone_punch(
        world,
        "F-201",
        ist(MONDAY, 10),
        decision="rejected",
        direction=None,
        reason_codes=["GATE_CODE_INVALID"],
        employee_id=None,
        claimed_employee_id=None,
        match_mode=None,
    )
    boss: TestClient = world["boss"]

    listed = boss.get("/api/v1/reviews", params={"tab": "rejected"}).json()["items"]
    summary = boss.get("/api/v1/reviews/summary").json()

    assert str(nameless.id) not in [item["punch"]["id"] for item in listed]
    assert summary["rejected_last_7_days"] == 0


def test_the_review_summary_counts_the_outside_plant_flag(world: dict) -> None:
    allow_outside_work(world, "F-201")
    outside_punch(world, "F-201", 9)
    outside_punch(world, "F-201", 11)

    summary = world["boss"].get("/api/v1/reviews/summary").json()

    assert summary["to_check"] == 2
    assert summary["by_code"] == {"OUTSIDE_PLANT": 2}


def test_the_list_and_the_panel_carry_the_outside_work_reason(world: dict) -> None:
    allow_outside_work(world, "F-201", reason="Supplier audit in Pune")
    punch = outside_punch(world, "F-201", 9)
    boss: TestClient = world["boss"]

    (item,) = boss.get("/api/v1/reviews", params={"channel": "phone"}).json()["items"]
    context = boss.get(f"/api/v1/punches/{punch.id}/review-context").json()

    assert item["outside_reason"] == "Supplier audit in Pune"
    assert item["bulk_confirmable"] is True
    assert item["punch"]["outside_plant"] is True
    assert context["outside_reason"] == "Supplier audit in Pune"
    assert context["bulk_confirmable"] is True
    assert context["punch"]["location"]["lat"] == pytest.approx(19.87)  # the map position


# --- Bulk confirm (F-76, AC-53) ---

BULK = "/api/v1/reviews/bulk-confirm"


def three_clean_and_one_travel(world: dict) -> tuple[list[Punch], Punch]:
    allow_outside_work(world, "F-201")
    allow_outside_work(world, "F-202")
    clean = [
        outside_punch(world, "F-201", 8, 0),
        outside_punch(world, "F-201", 9, 0),
        outside_punch(world, "F-202", 9, 30),
    ]
    travel = outside_punch(
        world, "F-202", 10, 0, reason_codes=["OUTSIDE_PLANT", "IMPOSSIBLE_TRAVEL"]
    )
    return clean, travel


def items_of(*punches: Punch) -> list[dict]:
    return [{"punch_id": str(p.id), "expected_latest_review_id": None} for p in punches]


def test_ac_53_only_the_clean_outside_punches_are_marked_and_confirmed(world: dict) -> None:
    clean, travel = three_clean_and_one_travel(world)
    boss: TestClient = world["boss"]

    listed = boss.get("/api/v1/reviews", params={"channel": "phone"}).json()["items"]
    marked = {item["punch"]["id"]: item["bulk_confirmable"] for item in listed}
    answer = boss.post(BULK, json={"items": items_of(*clean, travel), "note": "Checked the visits"})

    assert marked == {**{str(p.id): True for p in clean}, str(travel.id): False}
    assert answer.status_code == 200, answer.text
    results = {r["punch_id"]: r for r in answer.json()["results"]}
    assert [results[str(p.id)]["ok"] for p in clean] == [True, True, True]
    assert results[str(travel.id)] == {
        "punch_id": str(travel.id),
        "ok": False,
        "error_code": "NOT_BULK_CONFIRMABLE",
    }
    session: Session = world["session"]
    session.expire_all()
    reviews = session.scalars(select(PunchReview)).all()
    assert len(reviews) == 3
    assert {r.action for r in reviews} == {"confirmed"} and {r.reason for r in reviews} == {
        "Checked the visits"
    }
    audits = session.scalars(
        select(AuditLog).where(AuditLog.action == "punch_review.confirm")
    ).all()
    assert len(audits) == 3 and all((a.after or {}).get("bulk") is True for a in audits)


def test_confirmed_punches_leave_the_to_check_list_and_keep_counting(world: dict) -> None:
    clean, _ = three_clean_and_one_travel(world)
    boss: TestClient = world["boss"]

    boss.post(BULK, json={"items": items_of(*clean)})

    left = boss.get("/api/v1/reviews", params={"channel": "phone"}).json()["items"]
    reviewed = boss.get("/api/v1/reviews", params={"tab": "reviewed"}).json()["items"]
    assert [item["punch"]["employee"]["code"] for item in left] == ["F-202"]  # the travel punch
    assert len(reviewed) == 3 and all(i["bulk_confirmable"] is False for i in reviewed)
    assert {i["latest_review"]["action"] for i in reviewed} == {"confirmed"}


def test_the_corporate_head_and_the_plant_head_cannot_bulk_confirm(world: dict) -> None:
    clean, _ = three_clean_and_one_travel(world)

    for client in (world["corporate"], world["heads"]["head134"]):
        answer = client.post(BULK, json={"items": items_of(*clean)})
        assert answer.status_code == 403
        assert answer.json()["error"]["code"] == "FORBIDDEN"
    assert world["session"].scalars(select(PunchReview)).all() == []


def test_one_failing_row_never_undoes_the_others(world: dict) -> None:
    clean, travel = three_clean_and_one_travel(world)
    boss: TestClient = world["boss"]
    boss.post(
        f"/api/v1/punches/{clean[0].id}/reviews", json={"action": "not_accepted", "reason": "Wrong"}
    )
    unknown = uuid.uuid4()
    rejected = refused_punch(world, "F-203", 11)
    batch = [
        *items_of(*clean),  # the first was reviewed meanwhile: REVIEW_CHANGED
        {"punch_id": str(unknown), "expected_latest_review_id": None},
        *items_of(rejected),
    ]

    answer = boss.post(BULK, json={"items": batch})

    codes = [r.get("error_code") for r in answer.json()["results"]]
    assert codes == ["REVIEW_CHANGED", None, None, "NOT_FOUND", "REVIEW_NOT_ALLOWED"]
    world["session"].expire_all()
    confirmed = world["session"].scalars(
        select(PunchReview).where(PunchReview.action == "confirmed")
    )
    assert len(confirmed.all()) == 2
    assert travel.id  # untouched


def test_a_punch_reviewed_meanwhile_is_left_alone_even_when_the_screen_knew_it(
    world: dict,
) -> None:
    clean, _ = three_clean_and_one_travel(world)
    boss: TestClient = world["boss"]
    created = boss.post(
        f"/api/v1/punches/{clean[0].id}/reviews", json={"action": "confirm"}
    ).json()["review"]

    answer = boss.post(
        BULK,
        json={
            "items": [{"punch_id": str(clean[0].id), "expected_latest_review_id": created["id"]}]
        },
    )

    # It has a review already, so it is a case for a single review, not for the batch.
    assert answer.json()["results"][0]["error_code"] == "NOT_BULK_CONFIRMABLE"


def test_the_batch_is_checked_before_anything_is_written(world: dict) -> None:
    clean, _ = three_clean_and_one_travel(world)
    boss: TestClient = world["boss"]

    empty = boss.post(BULK, json={"items": []})
    too_many = boss.post(BULK, json={"items": items_of(*clean) * 40})  # 120 and duplicates
    twice = boss.post(BULK, json={"items": items_of(clean[0], clean[0])})
    long_note = boss.post(BULK, json={"items": items_of(clean[0]), "note": "x" * 301})

    for answer in (empty, too_many, twice, long_note):
        assert answer.status_code == 422
        assert answer.json()["error"]["code"] == "VALIDATION_FAILED"
    assert world["session"].scalars(select(PunchReview)).all() == []


def test_a_hundred_punches_are_the_most_one_batch_may_hold(world: dict) -> None:
    allow_outside_work(world, "F-201")
    punches = [outside_punch(world, "F-201", 8 + index // 60, index % 60) for index in range(100)]

    answer = world["boss"].post(BULK, json={"items": items_of(*punches)})

    assert answer.status_code == 200
    assert all(result["ok"] for result in answer.json()["results"])


def test_a_gate_punch_with_the_same_flag_alone_is_not_bulk_confirmable(world: dict) -> None:
    gate = gate_punch(world, "F-202", 9, decision="flagged", reason_codes=["OUTSIDE_PLANT"])

    answer = world["boss"].post(BULK, json={"items": items_of(gate)})

    assert answer.json()["results"][0]["error_code"] == "NOT_BULK_CONFIRMABLE"


# --- Employees list ---


def test_the_employees_list_filters_by_phone_punching_and_shows_the_field(world: dict) -> None:
    boss: TestClient = world["boss"]
    assert switch_phone(boss, str(world["people"]["F-201"])).status_code == 200

    everyone = boss.get("/api/v1/employees", params={"page_size": 100}).json()["items"]
    on = boss.get("/api/v1/employees", params={"phone": "on"}).json()["items"]
    off = boss.get("/api/v1/employees", params={"phone": "off"}).json()["items"]
    bad = boss.get("/api/v1/employees", params={"phone": "maybe"})

    assert {e["employee_code"]: e["phone_punch_enabled"] for e in everyone} == {
        "F-201": True,
        "F-202": False,
        "F-203": False,
        "F-204": False,
    }
    assert [e["employee_code"] for e in on] == ["F-201"]
    assert [e["employee_code"] for e in off] == ["F-202", "F-203", "F-204"]
    assert bad.status_code == 422


def test_switching_phone_punching_off_again_takes_the_employee_out_of_the_on_filter(
    world: dict,
) -> None:
    boss: TestClient = world["boss"]
    employee_id = str(world["people"]["F-201"])
    switch_phone(boss, employee_id)
    switch_phone(boss, employee_id, on=False)

    on = boss.get("/api/v1/employees", params={"phone": "on"}).json()["items"]

    assert on == []


# --- Audit viewer: employee actors ---


def test_the_audit_viewer_shows_the_code_and_name_of_an_employee_actor(world: dict) -> None:
    session: Session = world["session"]
    employee_id = world["people"]["F-201"]
    record_audit(
        session,
        actor=Actor("employee", employee_id, "203.0.113.7"),
        action="phone_auth.login",
        entity_type="employee",
        entity_id=employee_id,
        after={"method": "password"},
        plant_id=uuid.UUID(world["k134"].id),
    )
    session.commit()

    entries = world["boss"].get("/api/v1/audit", params={"actor_type": "employee"}).json()["items"]
    own_plant = world["heads"]["head134"].get("/api/v1/audit", params={"actor_type": "employee"})
    other_plant = world["heads"]["head200"].get("/api/v1/audit", params={"actor_type": "employee"})

    assert len(entries) == 1
    assert entries[0]["actor_type"] == "employee"
    assert entries[0]["actor_code"] == "F-201" and entries[0]["actor_name"] == "Person F-201"
    assert own_plant.json()["items"][0]["actor_code"] == "F-201"
    assert other_plant.json()["items"] == []


def test_a_user_actor_has_no_employee_code(world: dict) -> None:
    entries = world["boss"].get("/api/v1/audit", params={"actor_type": "user"}).json()["items"]

    assert entries and all(entry["actor_code"] is None for entry in entries)
    assert any(entry["actor_name"] for entry in entries)


# --- Cards ending soon: "Phone punching on" ---


def test_cards_ending_soon_show_who_has_phone_punching_on(world: dict) -> None:
    boss: TestClient = world["boss"]
    workers = {}
    for code in ("Q-301", "Q-302"):
        body = temporary_body(world["k134"], code=code, name=f"Worker {code}")
        workers[code] = boss.post("/api/v1/employees", json=body).json()["id"]
        card = boss.post(
            f"/api/v1/employees/{workers[code]}/qr-cards", json={"valid_until": "2026-11-08"}
        )
        assert card.status_code == 201, card.text
    assert switch_phone(boss, workers["Q-301"]).status_code == 200

    listed = boss.get("/api/v1/qr-cards", params={"state": "expiring", "page_size": 100}).json()
    count = boss.get("/api/v1/qr-cards/expiring-count").json()

    flags = {item["employee"]["code"]: item["phone_punch_enabled"] for item in listed["items"]}
    assert flags == {"Q-301": True, "Q-302": False}
    assert count["count"] == 2 and count["phone_on_count"] == 1
