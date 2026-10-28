"""The anti-proxy rules for a card punch, each tested alone and then together in the engine
(spec M2 §7 rules 4-8; AC-8, AC-9, AC-11 to AC-14, AC-17, AC-32). Real PostgreSQL, fake data."""

import uuid
from collections.abc import Callable
from datetime import UTC, datetime, time, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.antiproxy.context import Outcome, PunchContext, PunchLimits, RuleResult
from app.antiproxy.engine import run_qr_rules
from app.antiproxy.rules.cooldown import check_in_out
from app.antiproxy.rules.qr_credential import check_qr_credential
from app.antiproxy.rules.snapshot import check_snapshot
from app.core.config import get_settings
from app.core.time import IST, today_ist
from app.modules.kiosks.location_check import Location
from app.modules.kiosks.models import KioskDevice
from app.modules.punches.models import Direction, Punch
from app.modules.qr_cards.models import QrCredential
from app.modules.qr_cards.payload import build_payload
from app.modules.users.models import Role
from tests.image_helpers import make_jpeg, make_png
from tests.kiosk_helpers import GATE_LAT, GATE_LON, ensure_gate_fence
from tests.people_helpers import PlantIds, client_for, create_plant, permanent_body, temporary_body

LIMITS = PunchLimits(
    punch_cooldown_minutes=2,
    min_minutes_before_out=30,
    open_in_max_hours=20,
    snapshot_dark_threshold=40,
)
# "Server time" for the rules: today at 10:00 IST (04:30 UTC). It follows the real date because a
# card made by the test is valid from today, and a fixed date would one day be "before" it.
TODAY_IST = today_ist()
NOW = datetime.combine(TODAY_IST, time(10, 0), tzinfo=IST).astimezone(UTC)


@pytest.fixture
def boss(db_app: FastAPI, db_session: Session) -> TestClient:
    return client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")


@pytest.fixture
def k134(boss: TestClient, db_session: Session) -> PlantIds:
    return create_plant(boss, db_session, "K134")


@pytest.fixture
def tp1(boss: TestClient, db_session: Session) -> PlantIds:
    return create_plant(boss, db_session, "TP1")


def make_kiosk(session: Session, plant: PlantIds) -> KioskDevice:
    ensure_gate_fence(session, uuid.UUID(plant.id))
    device = KioskDevice(
        plant_id=uuid.UUID(plant.id), name=f"Gate {uuid.uuid4().hex[:4]}", status="active"
    )
    session.add(device)
    session.flush()
    return device


@pytest.fixture
def kiosk(db_session: Session, k134: PlantIds) -> KioskDevice:
    return make_kiosk(db_session, k134)


class Worker:
    """A temporary worker with a working card, and the QR text of that card."""

    def __init__(self, employee_id: str, card: dict) -> None:
        self.employee_id = uuid.UUID(employee_id)
        self.card_id = uuid.UUID(card["id"])
        self.serial: str = card["serial"]
        self.qr_text = build_payload(get_settings(), self.serial)


@pytest.fixture
def worker(boss: TestClient, k134: PlantIds) -> Worker:
    employee = boss.post("/api/v1/employees", json=temporary_body(k134)).json()
    card = boss.post(f"/api/v1/employees/{employee['id']}/qr-cards", json={}).json()["card"]
    return Worker(employee["id"], card)


@pytest.fixture
def make_context(db_session: Session, kiosk: KioskDevice) -> Callable[..., PunchContext]:
    def build(**changes: object) -> PunchContext:
        values: dict[str, object] = {
            "session": db_session,
            "app_settings": get_settings(),
            "kiosk": kiosk,
            "now": NOW,
            "limits": LIMITS,
            "qr_text": None,
            "snapshot_bytes": make_jpeg(),
            "location": Location(GATE_LAT, GATE_LON, 12.0),
        }
        return PunchContext(**{**values, **changes})  # type: ignore[arg-type]

    return build


def add_punch(
    session: Session,
    kiosk: KioskDevice,
    worker: Worker,
    direction: str,
    age: timedelta,
    decision: str = "accepted",
) -> Punch:
    punch = Punch(
        client_punch_id=uuid.uuid4(),
        kiosk_id=kiosk.id,
        plant_id=kiosk.plant_id,
        employee_id=worker.employee_id,
        qr_credential_id=worker.card_id,
        method="qr",
        direction=direction if decision == "accepted" else None,
        decision=decision,
        reason_codes=[] if decision == "accepted" else ["COOLDOWN_ACTIVE"],
        server_received_at=NOW - age,
    )
    session.add(punch)
    session.flush()
    return punch


# --- Rule: snapshot ---------------------------------------------------------------------------


def test_snapshot_rule_accepts_a_good_photo_and_keeps_the_checked_copy(
    make_context: Callable[..., PunchContext],
) -> None:
    context = make_context()

    assert check_snapshot(context).outcome is Outcome.ALLOW
    assert context.snapshot is not None


def test_snapshot_rule_rejects_a_missing_photo(make_context: Callable[..., PunchContext]) -> None:
    for missing in (None, b""):
        result = check_snapshot(make_context(snapshot_bytes=missing))
        assert result.reason_code == "SNAPSHOT_MISSING"


def test_snapshot_rule_rejects_files_that_are_not_good_jpegs(
    make_context: Callable[..., PunchContext],
) -> None:
    for bad in (make_png(), b"not a picture", make_jpeg(100, 100), make_jpeg() + b"\0" * 50_000):
        assert check_snapshot(make_context(snapshot_bytes=bad)).reason_code == "SNAPSHOT_INVALID"


def test_snapshot_rule_marks_a_dark_photo_but_still_passes_it(
    make_context: Callable[..., PunchContext],
) -> None:
    context = make_context(snapshot_bytes=make_jpeg(colour=(5, 5, 5)))

    assert check_snapshot(context).outcome is Outcome.ALLOW
    assert context.snapshot is not None and context.snapshot.is_dark


# --- Rule: card -------------------------------------------------------------------------------


def card_result(context: PunchContext) -> str | None:
    return check_qr_credential(context).reason_code


def test_a_working_card_of_this_plant_passes_and_fills_in_the_employee(
    make_context: Callable[..., PunchContext], worker: Worker
) -> None:
    context = make_context(qr_text=worker.qr_text)

    assert check_qr_credential(context).outcome is Outcome.ALLOW
    assert context.employee is not None and context.employee.id == worker.employee_id
    assert context.card is not None and context.card.id == worker.card_id


@pytest.mark.parametrize(
    "text", [None, "", "hello", "UPS1.A.C000001", "http://example.com/UPS1.A.C000001.X"]
)
def test_text_that_is_not_a_card_has_a_bad_format(
    make_context: Callable[..., PunchContext], text: str | None
) -> None:
    assert card_result(make_context(qr_text=text)) == "QR_FORMAT_INVALID"


def test_a_card_text_with_a_changed_character_has_a_bad_signature(
    make_context: Callable[..., PunchContext], worker: Worker
) -> None:
    middle = worker.qr_text[-10]
    forged = worker.qr_text[:-10] + ("A" if middle != "A" else "B") + worker.qr_text[-9:]
    assert card_result(make_context(qr_text=forged)) == "QR_SIGNATURE_INVALID"

    changed_serial = worker.qr_text.replace(worker.serial, "C" + "9" * 6, 1)
    assert card_result(make_context(qr_text=changed_serial)) == "QR_SIGNATURE_INVALID"


def test_a_correctly_signed_text_for_an_unknown_serial_is_refused_like_a_forgery(
    make_context: Callable[..., PunchContext],
) -> None:
    unknown = build_payload(get_settings(), "C999999")

    assert card_result(make_context(qr_text=unknown)) == "QR_SIGNATURE_INVALID"


def test_a_card_signed_with_another_key_id_is_refused(
    make_context: Callable[..., PunchContext], worker: Worker
) -> None:
    other_key = worker.qr_text.replace("UPS1.A.", "UPS1.B.", 1)

    assert card_result(make_context(qr_text=other_key)) == "QR_SIGNATURE_INVALID"


def test_a_revoked_card_is_refused(
    boss: TestClient, make_context: Callable[..., PunchContext], worker: Worker
) -> None:
    response = boss.post(
        f"/api/v1/qr-cards/{worker.card_id}/revoke", json={"kind": "lost", "reason": "Lost it"}
    )
    assert response.status_code == 200, response.text

    assert card_result(make_context(qr_text=worker.qr_text)) == "QR_REVOKED"


def set_card_dates(session: Session, worker: Worker, **dates: object) -> None:
    card = session.get(QrCredential, worker.card_id)
    assert card is not None
    for field, value in dates.items():
        setattr(card, field, value)
    session.flush()


def test_a_card_is_valid_on_both_of_its_end_days(
    db_session: Session, make_context: Callable[..., PunchContext], worker: Worker
) -> None:
    today = TODAY_IST
    set_card_dates(db_session, worker, valid_from=today, valid_until=today)

    assert check_qr_credential(make_context(qr_text=worker.qr_text)).outcome is Outcome.ALLOW


def test_a_card_that_has_not_started_or_has_ended_is_refused(
    db_session: Session, make_context: Callable[..., PunchContext], worker: Worker
) -> None:
    today = NOW.date()
    set_card_dates(db_session, worker, valid_from=today + timedelta(days=1))
    assert card_result(make_context(qr_text=worker.qr_text)) == "QR_NOT_YET_VALID"

    set_card_dates(
        db_session,
        worker,
        valid_from=today - timedelta(days=30),
        valid_until=today - timedelta(days=1),
    )
    assert card_result(make_context(qr_text=worker.qr_text)) == "QR_EXPIRED"


def test_the_card_day_is_the_ist_day_not_the_utc_day(
    db_session: Session, make_context: Callable[..., PunchContext], worker: Worker
) -> None:
    # 23:00 UTC today is already 04:30 IST tomorrow.
    late_utc = datetime.combine(TODAY_IST, time(23, 0), tzinfo=UTC)
    set_card_dates(db_session, worker, valid_from=TODAY_IST, valid_until=TODAY_IST)

    context = make_context(qr_text=worker.qr_text, now=late_utc)

    assert card_result(context) == "QR_EXPIRED"


def test_a_card_of_an_employee_who_left_is_refused(
    db_session: Session, make_context: Callable[..., PunchContext], worker: Worker
) -> None:
    context = make_context(qr_text=worker.qr_text)
    check_qr_credential(context)
    assert context.employee is not None
    context.employee.status = "left"
    db_session.flush()

    assert card_result(make_context(qr_text=worker.qr_text)) == "EMPLOYEE_INACTIVE"


def test_a_card_of_an_employee_who_punches_by_face_is_refused(
    db_session: Session, make_context: Callable[..., PunchContext], worker: Worker
) -> None:
    context = make_context(qr_text=worker.qr_text)
    check_qr_credential(context)
    assert context.employee is not None
    context.employee.punch_method = "face"
    db_session.flush()

    assert card_result(make_context(qr_text=worker.qr_text)) == "EMPLOYEE_NOT_QR"


def test_a_card_works_only_at_its_owners_plant(
    db_session: Session, make_context: Callable[..., PunchContext], worker: Worker, tp1: PlantIds
) -> None:
    other_gate = make_kiosk(db_session, tp1)

    context = make_context(qr_text=worker.qr_text, kiosk=other_gate)

    assert card_result(context) == "WRONG_PLANT"
    assert context.employee is not None  # known, so the log can name the person


def test_a_test_card_stops_the_rules_as_a_self_test(
    boss: TestClient, make_context: Callable[..., PunchContext]
) -> None:
    card = boss.post("/api/v1/qr-test-cards", json={"label": "Main gate"}).json()
    qr_text = build_payload(get_settings(), card["serial"])

    context = make_context(qr_text=qr_text)

    assert check_qr_credential(context).outcome is Outcome.SELF_TEST
    assert context.employee is None


def test_a_revoked_test_card_is_refused(
    boss: TestClient, make_context: Callable[..., PunchContext]
) -> None:
    card = boss.post("/api/v1/qr-test-cards", json={"label": "Old"}).json()
    revoked = boss.post(f"/api/v1/qr-test-cards/{card['id']}/revoke", json={"reason": "Not needed"})
    assert revoked.status_code == 200, revoked.text

    context = make_context(qr_text=build_payload(get_settings(), card["serial"]))

    assert card_result(context) == "QR_REVOKED"


def test_a_card_of_a_permanent_employee_on_qr_is_accepted(
    boss: TestClient, k134: PlantIds, make_context: Callable[..., PunchContext]
) -> None:
    """Any employee set to QR may punch with a card, permanent or temporary (decision 0009)."""
    body = permanent_body(k134, code="2001") | {"punch_method": "qr"}
    employee = boss.post("/api/v1/employees", json=body).json()
    card = boss.post(f"/api/v1/employees/{employee['id']}/qr-cards", json={}).json()["card"]

    context = make_context(qr_text=build_payload(get_settings(), card["serial"]))

    assert check_qr_credential(context).outcome is Outcome.ALLOW


# --- Rule: IN / OUT and cool-down -------------------------------------------------------------


def decide(
    make_context: Callable[..., PunchContext], worker: Worker, db_session: Session
) -> tuple[str | None, Direction | None]:
    context = make_context(qr_text=worker.qr_text)
    check_qr_credential(context)
    result = check_in_out(context)
    return result.reason_code, context.direction


def test_the_first_punch_ever_is_an_in(
    db_session: Session, make_context: Callable[..., PunchContext], worker: Worker
) -> None:
    assert decide(make_context, worker, db_session) == (None, Direction.IN)


@pytest.mark.parametrize(
    ("age", "expected"),
    [
        (timedelta(seconds=30), ("COOLDOWN_ACTIVE", None)),
        (timedelta(minutes=2) - timedelta(seconds=1), ("COOLDOWN_ACTIVE", None)),
        (timedelta(minutes=2), ("OUT_TOO_SOON", None)),
        (timedelta(minutes=10), ("OUT_TOO_SOON", None)),
        (timedelta(minutes=30) - timedelta(seconds=1), ("OUT_TOO_SOON", None)),
        (timedelta(minutes=30), (None, Direction.OUT)),
        (timedelta(hours=9), (None, Direction.OUT)),
        (timedelta(hours=20) - timedelta(seconds=1), (None, Direction.OUT)),
        (timedelta(hours=20), (None, Direction.IN)),
        (timedelta(hours=24), (None, Direction.IN)),
    ],
)
def test_the_decision_after_an_in(
    db_session: Session,
    kiosk: KioskDevice,
    make_context: Callable[..., PunchContext],
    worker: Worker,
    age: timedelta,
    expected: tuple[str | None, Direction | None],
) -> None:
    add_punch(db_session, kiosk, worker, "in", age)

    assert decide(make_context, worker, db_session) == expected


@pytest.mark.parametrize(
    ("age", "expected"),
    [
        (timedelta(seconds=90), ("COOLDOWN_ACTIVE", None)),
        (timedelta(minutes=2), (None, Direction.IN)),
        (timedelta(hours=3), (None, Direction.IN)),
    ],
)
def test_the_decision_after_an_out(
    db_session: Session,
    kiosk: KioskDevice,
    make_context: Callable[..., PunchContext],
    worker: Worker,
    age: timedelta,
    expected: tuple[str | None, Direction | None],
) -> None:
    add_punch(db_session, kiosk, worker, "out", age)

    assert decide(make_context, worker, db_session) == expected


def test_a_night_shift_in_at_seven_pm_is_followed_by_an_out_at_seven_am(
    db_session: Session,
    kiosk: KioskDevice,
    make_context: Callable[..., PunchContext],
    worker: Worker,
) -> None:
    in_time = datetime.combine(TODAY_IST - timedelta(days=1), time(19, 0), tzinfo=IST)
    out_time = datetime.combine(TODAY_IST, time(7, 5), tzinfo=IST)  # 12 h 5 min later
    add_punch(db_session, kiosk, worker, "in", NOW - in_time)

    context = make_context(qr_text=worker.qr_text, now=out_time)
    check_qr_credential(context)

    assert check_in_out(context).outcome is Outcome.ALLOW
    assert context.direction is Direction.OUT


def test_rejected_punches_do_not_count_for_the_decision(
    db_session: Session,
    kiosk: KioskDevice,
    make_context: Callable[..., PunchContext],
    worker: Worker,
) -> None:
    add_punch(db_session, kiosk, worker, "in", timedelta(hours=2))
    add_punch(db_session, kiosk, worker, "in", timedelta(seconds=10), decision="rejected")

    assert decide(make_context, worker, db_session) == (None, Direction.OUT)


def test_the_last_accepted_punch_counts_at_any_plant(
    db_session: Session,
    tp1: PlantIds,
    make_context: Callable[..., PunchContext],
    worker: Worker,
) -> None:
    other_gate = make_kiosk(db_session, tp1)
    add_punch(db_session, other_gate, worker, "in", timedelta(seconds=30))

    assert decide(make_context, worker, db_session) == ("COOLDOWN_ACTIVE", None)


def test_the_in_out_rule_needs_the_card_rule_first(
    make_context: Callable[..., PunchContext],
) -> None:
    with pytest.raises(RuntimeError):
        check_in_out(make_context())


# --- The engine -------------------------------------------------------------------------------


def test_the_engine_accepts_a_good_punch_with_its_direction(
    make_context: Callable[..., PunchContext], worker: Worker
) -> None:
    decision = run_qr_rules(make_context(qr_text=worker.qr_text))

    assert decision.outcome is Outcome.ALLOW
    assert decision.reason_codes == []
    assert decision.direction is Direction.IN


def test_the_first_rule_that_rejects_decides_and_later_rules_do_not_run(
    make_context: Callable[..., PunchContext], worker: Worker
) -> None:
    """A missing photo AND a bad card: the photo rule comes first, so only it is reported."""
    context = make_context(qr_text="nonsense", snapshot_bytes=None)

    decision = run_qr_rules(context)

    assert decision.reason_codes == ["SNAPSHOT_MISSING"]
    assert context.card is None and context.employee is None


def test_a_bad_card_with_a_good_photo_is_reported_as_the_card(
    make_context: Callable[..., PunchContext],
) -> None:
    decision = run_qr_rules(make_context(qr_text="nonsense"))

    assert decision.outcome is Outcome.REJECT
    assert decision.reason_codes == ["QR_FORMAT_INVALID"]
    assert decision.direction is None


def test_the_engine_reports_a_test_card_as_a_self_test(
    boss: TestClient, make_context: Callable[..., PunchContext]
) -> None:
    card = boss.post("/api/v1/qr-test-cards", json={"label": "Gate"}).json()

    decision = run_qr_rules(make_context(qr_text=build_payload(get_settings(), card["serial"])))

    assert decision.outcome is Outcome.SELF_TEST
    assert decision.reason_codes == []


def test_a_test_card_still_needs_a_usable_photo(
    boss: TestClient, make_context: Callable[..., PunchContext]
) -> None:
    card = boss.post("/api/v1/qr-test-cards", json={"label": "Gate"}).json()
    qr_text = build_payload(get_settings(), card["serial"])

    decision = run_qr_rules(make_context(qr_text=qr_text, snapshot_bytes=b"junk"))

    assert decision.reason_codes == ["SNAPSHOT_INVALID"]


def test_a_rule_cannot_reject_without_a_reason_code() -> None:
    """A refusal without a code could slip through as a pass, so it cannot be built at all."""
    with pytest.raises(ValueError):
        RuleResult(Outcome.REJECT)
