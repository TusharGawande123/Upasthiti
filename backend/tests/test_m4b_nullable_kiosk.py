"""Phone punches have no gate device (M4b, migration 0027): every screen and file that lists
punches must still work when `kiosk_id` is NULL (plan cross-cutting 9). The phone rows are written
straight into the database (the phone module comes in P1). Real PostgreSQL, fake data, the clock
pinned to Fri 30/10/2026 10:00 IST (the dashboard tests' world)."""

import uuid
from datetime import timedelta

import pytest
from sqlalchemy.orm import Session

from app.antiproxy.context import DeviceIdentity, PunchContext, PunchLimits
from app.antiproxy.nearby_punches import punches_elsewhere
from app.core.config import get_settings
from app.modules.employees.models import Employee
from app.modules.punches.models import Punch
from tests.clock_helpers import ist
from tests.phone_helpers import make_phone_punch, make_phone_session
from tests.test_m5_dashboard import FRIDAY, pinned_clock, punch, world  # noqa: F401  (fixtures)

PUNCHES = "/api/v1/punches"


@pytest.fixture
def phone_rows(world: dict) -> dict[str, Punch]:  # noqa: F811
    session: Session = world["session"]
    plant_id = uuid.UUID(world["plant"].id)
    people = world["people"]
    inside = make_phone_session(session, people["P-1"], ist(FRIDAY, 8))
    edge = make_phone_session(session, people["P-2"], ist(FRIDAY, 8))
    rows = {
        "accepted": make_phone_punch(session, inside, plant_id, ist(FRIDAY, 9, 5)),
        "flagged": make_phone_punch(
            session,
            edge,
            plant_id,
            ist(FRIDAY, 9, 10),
            decision="flagged",
            reason_codes=["LOCATION_AT_EDGE"],
        ),
        "rejected": make_phone_punch(
            session,
            edge,
            plant_id,
            ist(FRIDAY, 9, 40),
            decision="rejected",
            reason_codes=["FACE_NOT_RECOGNISED"],
            direction=None,
            match_mode=None,
            employee_id=None,
            claimed_employee_id=people["P-2"],
        ),
    }
    punch(world, "P-3", ist(FRIDAY, 9, 0), "in")  # a gate punch next to them
    session.commit()
    return rows


def test_the_punch_log_list_detail_and_export_show_phone_punches(
    world: dict,  # noqa: F811
    phone_rows: dict[str, Punch],
) -> None:
    boss = world["boss"]
    listed = boss.get(PUNCHES, params={"date": FRIDAY.isoformat()})
    assert listed.status_code == 200, listed.text
    by_id = {item["id"]: item for item in listed.json()["items"]}
    for row in phone_rows.values():
        assert by_id[str(row.id)]["kiosk"] is None
    assert sum(1 for item in by_id.values() if item["kiosk"] is not None) == 1  # the gate punch

    detail = boss.get(f"{PUNCHES}/{phone_rows['accepted'].id}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["kiosk"] is None

    export = boss.get(f"{PUNCHES}/export.xlsx", params={"date": FRIDAY.isoformat()})
    assert export.status_code == 200, export.text


def test_needs_review_lists_and_opens_a_phone_punch(
    world: dict,  # noqa: F811
    phone_rows: dict[str, Punch],
) -> None:
    boss = world["boss"]
    flagged_id = str(phone_rows["flagged"].id)
    listed = boss.get("/api/v1/reviews")
    assert listed.status_code == 200, listed.text
    assert flagged_id in {item["punch"]["id"] for item in listed.json()["items"]}
    rejected = boss.get("/api/v1/reviews", params={"tab": "rejected"})
    assert rejected.status_code == 200, rejected.text

    for row in phone_rows.values():
        context = boss.get(f"{PUNCHES}/{row.id}/review-context")
        assert context.status_code == 200, context.text
    # A gate device's edge hint never counts phone positions.
    hints = boss.get(f"{PUNCHES}/{flagged_id}/review-context").json()["hints"]
    assert all(hint["kind"] != "device_edge_flags" for hint in hints)


def test_dashboard_muster_day_view_and_reports_take_phone_punches(
    world: dict,  # noqa: F811
    phone_rows: dict[str, Punch],
) -> None:
    boss = world["boss"]
    plant_id = world["plant"].id
    for url, params in (
        ("/api/v1/dashboard/live", {}),
        ("/api/v1/muster", {"plant_id": plant_id}),
        (f"/api/v1/attendance/employee/{world['people']['P-1']}/day/{FRIDAY}", {}),
        (f"/api/v1/attendance/employee/{world['people']['P-2']}/day/{FRIDAY}", {}),
        (
            "/api/v1/reports/rejected-punches.xlsx",
            {"date_from": FRIDAY.isoformat(), "date_to": FRIDAY.isoformat(), "plant_id": plant_id},
        ),
    ):
        response = boss.get(url, params=params)
        assert response.status_code == 200, (url, response.text)


def test_a_phone_punch_is_another_device_for_the_flag_rules(
    world: dict,  # noqa: F811
    phone_rows: dict[str, Punch],
    make_flag_context,
) -> None:
    accepted = phone_rows["accepted"]
    assert accepted.phone_session_id is not None
    kiosk = world["kiosk"]
    at_the_gate = make_flag_context(DeviceIdentity.of_kiosk(kiosk), kiosk.plant_id)
    same_phone = make_flag_context(
        DeviceIdentity.of_phone_session(accepted.phone_session_id), kiosk.plant_id
    )
    other_phone = make_flag_context(DeviceIdentity.of_phone_session(uuid.uuid4()), kiosk.plant_id)

    def found(context) -> set[uuid.UUID]:  # noqa: ANN001
        return {other.punch.id for other in punches_elsewhere(context, timedelta(hours=1))}

    assert accepted.id in found(at_the_gate)
    assert accepted.id not in found(same_phone)
    assert accepted.id in found(other_phone)


def test_a_device_identity_is_one_device_or_one_sign_in() -> None:
    with pytest.raises(ValueError):
        DeviceIdentity()
    with pytest.raises(ValueError):
        DeviceIdentity(kiosk_id=uuid.uuid4(), phone_session_id=uuid.uuid4())


@pytest.fixture
def make_flag_context(world: dict):  # noqa: ANN201, F811
    def build(device: DeviceIdentity, plant_id: uuid.UUID) -> PunchContext:
        employee = world["session"].get(Employee, world["people"]["P-1"])
        return PunchContext(
            session=world["session"],
            app_settings=get_settings(),
            plant_id=plant_id,
            device_identity=device,
            now=ist(FRIDAY, 9, 20),
            limits=PunchLimits(
                punch_cooldown_minutes=2,
                min_minutes_before_out=30,
                open_in_max_hours=20,
                snapshot_dark_threshold=40,
            ),
            qr_text=None,
            snapshot_bytes=None,
            employee=employee,
        )

    return build
