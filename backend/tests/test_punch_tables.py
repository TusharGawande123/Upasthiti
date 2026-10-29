"""The punch, snapshot and notice tables: append-only punches, the checks the database enforces,
the indexes and the new kiosk fields (spec §6, AC-19). These talk to a real PostgreSQL."""

import uuid
from datetime import timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import Session

from app.core.time import utc_now
from app.modules.audit.models import AuditLog
from app.modules.kiosks.models import KioskDevice
from app.modules.notices.models import KioskNotice
from app.modules.punches.models import Punch, PunchSnapshot
from app.modules.users.models import Role, User
from tests.people_helpers import PlantIds, client_for, create_plant, temporary_body


@pytest.fixture
def boss(db_app: FastAPI, db_session: Session) -> TestClient:
    return client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")


@pytest.fixture
def k134(boss: TestClient, db_session: Session) -> PlantIds:
    return create_plant(boss, db_session, "K134")


@pytest.fixture
def kiosk(k134: PlantIds, db_session: Session) -> KioskDevice:
    device = KioskDevice(plant_id=uuid.UUID(k134.id), name="Main gate", status="active")
    db_session.add(device)
    db_session.flush()
    return device


@pytest.fixture
def worker_and_card(boss: TestClient, k134: PlantIds) -> tuple[str, str]:
    employee = boss.post("/api/v1/employees", json=temporary_body(k134)).json()
    card = boss.post(f"/api/v1/employees/{employee['id']}/qr-cards", json={}).json()["card"]
    return employee["id"], card["id"]


def make_punch(
    session: Session,
    kiosk: KioskDevice,
    worker_and_card: tuple[str, str],
    **changes: object,
) -> Punch:
    employee_id, card_id = worker_and_card
    values: dict[str, object] = {
        "client_punch_id": uuid.uuid4(),
        "kiosk_id": kiosk.id,
        "plant_id": kiosk.plant_id,
        "employee_id": uuid.UUID(employee_id),
        "qr_credential_id": uuid.UUID(card_id),
        "method": "qr",
        "direction": "in",
        "decision": "accepted",
        "reason_codes": [],
        "server_received_at": utc_now(),
    }
    punch = Punch(**{**values, **changes})
    session.add(punch)
    session.flush()
    return punch


def make_snapshot(session: Session, punch: Punch, **changes: object) -> PunchSnapshot:
    now = utc_now()
    values: dict[str, object] = {
        "punch_id": punch.id,
        "storage_key": f"snapshots/2026/10/20/{punch.id}.bin",
        "size_bytes": 15_000,
        "width": 320,
        "height": 240,
        "brightness": 120,
        "is_dark": False,
        "taken_at": now,
        "expires_at": now + timedelta(days=60),
        "state": "stored",
    }
    snapshot = PunchSnapshot(**{**values, **changes})
    session.add(snapshot)
    session.flush()
    return snapshot


# --- Punches: a good row, then the rules ------------------------------------------------------


def test_an_accepted_punch_is_saved_with_its_defaults(
    db_session: Session, kiosk: KioskDevice, worker_and_card: tuple[str, str]
) -> None:
    punch = make_punch(db_session, kiosk, worker_and_card)
    db_session.refresh(punch)

    assert punch.decision == "accepted"
    assert punch.reason_codes == []
    assert punch.was_offline is False
    assert punch.device_claimed_at is None
    assert punch.ip is None


def test_a_rejected_punch_keeps_its_reasons_and_may_have_no_person(
    db_session: Session, kiosk: KioskDevice
) -> None:
    punch = Punch(
        client_punch_id=uuid.uuid4(),
        kiosk_id=kiosk.id,
        plant_id=kiosk.plant_id,
        method="qr",
        direction=None,
        decision="rejected",
        reason_codes=["QR_SIGNATURE_INVALID"],
        server_received_at=utc_now(),
    )
    db_session.add(punch)
    db_session.flush()
    db_session.refresh(punch)

    assert punch.reason_codes == ["QR_SIGNATURE_INVALID"]
    assert punch.employee_id is None
    assert punch.qr_credential_id is None


def test_the_kiosks_location_and_address_are_stored_as_sent(
    db_session: Session, kiosk: KioskDevice, worker_and_card: tuple[str, str]
) -> None:
    punch = make_punch(
        db_session,
        kiosk,
        worker_and_card,
        lat=19.8762,
        lon=75.3433,
        accuracy_m=12.5,
        ip="203.0.113.7",
    )
    db_session.refresh(punch)

    assert (float(punch.lat or 0), float(punch.lon or 0), float(punch.accuracy_m or 0)) == (
        19.8762,
        75.3433,
        12.5,
    )
    assert str(punch.ip) == "203.0.113.7"


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE punches SET direction = 'out'",
        "UPDATE punches SET decision = 'rejected'",
        "DELETE FROM punches",
        # The face tables that point to punches are named too, so the trigger is what refuses.
        "TRUNCATE punches, punch_snapshots, face_pending_matches, punch_reviews",
    ],
)
def test_the_database_refuses_to_change_or_delete_a_punch(
    db_session: Session,
    kiosk: KioskDevice,
    worker_and_card: tuple[str, str],
    statement: str,
) -> None:
    make_punch(db_session, kiosk, worker_and_card)

    with pytest.raises(DBAPIError, match="append-only"), db_session.begin_nested():
        db_session.execute(text(statement))

    assert db_session.scalars(select(Punch)).one() is not None  # still there, unchanged


def test_a_punch_writes_no_audit_row_by_itself(
    db_session: Session, kiosk: KioskDevice, worker_and_card: tuple[str, str]
) -> None:
    before = len(db_session.scalars(select(AuditLog)).all())

    make_punch(db_session, kiosk, worker_and_card)

    assert len(db_session.scalars(select(AuditLog)).all()) == before  # decision 0008: none


def test_the_same_scan_cannot_be_saved_twice(
    db_session: Session, kiosk: KioskDevice, worker_and_card: tuple[str, str]
) -> None:
    scan = uuid.uuid4()
    make_punch(db_session, kiosk, worker_and_card, client_punch_id=scan)

    with (
        pytest.raises(IntegrityError, match="uq_punches_kiosk_client_punch"),
        db_session.begin_nested(),
    ):
        make_punch(db_session, kiosk, worker_and_card, client_punch_id=scan)


def test_two_kiosks_may_use_the_same_scan_id(
    db_session: Session, kiosk: KioskDevice, worker_and_card: tuple[str, str]
) -> None:
    other = KioskDevice(plant_id=kiosk.plant_id, name="Side gate", status="active")
    db_session.add(other)
    db_session.flush()
    scan = uuid.uuid4()

    make_punch(db_session, kiosk, worker_and_card, client_punch_id=scan)
    make_punch(db_session, other, worker_and_card, client_punch_id=scan)

    assert len(db_session.scalars(select(Punch)).all()) == 2


@pytest.mark.parametrize(
    ("changes", "constraint"),
    [
        ({"direction": None}, "ck_punches_accepted_has_direction"),
        ({"reason_codes": ["COOLDOWN_ACTIVE"]}, "ck_punches_reason_codes_match_decision"),
        (
            {"decision": "rejected", "direction": None, "reason_codes": []},
            "ck_punches_reason_codes_match_decision",
        ),
        ({"method": "nfc"}, "ck_punches_method_known"),
        ({"decision": "banana", "reason_codes": ["X"]}, "ck_punches_decision_known"),
        ({"direction": "up"}, "ck_punches_direction_known"),
        ({"lat": 91}, "ck_punches_location_in_range"),
        ({"lon": -181}, "ck_punches_location_in_range"),
    ],
)
def test_the_database_refuses_an_inconsistent_punch(
    db_session: Session,
    kiosk: KioskDevice,
    worker_and_card: tuple[str, str],
    changes: dict[str, object],
    constraint: str,
) -> None:
    with pytest.raises(IntegrityError, match=constraint), db_session.begin_nested():
        make_punch(db_session, kiosk, worker_and_card, **changes)


def test_a_punch_needs_a_real_kiosk_and_plant(
    db_session: Session, kiosk: KioskDevice, worker_and_card: tuple[str, str]
) -> None:
    with pytest.raises(IntegrityError, match="fk_punches_kiosk_id"), db_session.begin_nested():
        make_punch(db_session, kiosk, worker_and_card, kiosk_id=uuid.uuid4())
    with pytest.raises(IntegrityError, match="fk_punches_plant_id"), db_session.begin_nested():
        make_punch(db_session, kiosk, worker_and_card, plant_id=uuid.uuid4())


# --- Snapshots --------------------------------------------------------------------------------


def test_a_snapshot_row_can_be_marked_purged_but_the_punch_stays_untouched(
    db_session: Session, kiosk: KioskDevice, worker_and_card: tuple[str, str]
) -> None:
    punch = make_punch(db_session, kiosk, worker_and_card)
    snapshot = make_snapshot(db_session, punch)

    snapshot.state = "purged"
    snapshot.purged_at = utc_now()
    db_session.flush()
    db_session.expire_all()

    stored = db_session.get(PunchSnapshot, snapshot.id)
    assert stored is not None
    assert stored.state == "purged"
    assert db_session.get(Punch, punch.id).decision == "accepted"  # type: ignore[union-attr]


def test_a_snapshot_whose_upload_failed_is_a_valid_state(
    db_session: Session, kiosk: KioskDevice, worker_and_card: tuple[str, str]
) -> None:
    punch = make_punch(db_session, kiosk, worker_and_card)

    snapshot = make_snapshot(db_session, punch, state="upload_failed")

    assert snapshot.purged_at is None


def test_each_punch_has_at_most_one_snapshot(
    db_session: Session, kiosk: KioskDevice, worker_and_card: tuple[str, str]
) -> None:
    punch = make_punch(db_session, kiosk, worker_and_card)
    make_snapshot(db_session, punch)

    with (
        pytest.raises(IntegrityError, match="uq_punch_snapshots_punch_id"),
        db_session.begin_nested(),
    ):
        make_snapshot(db_session, punch)


@pytest.mark.parametrize(
    ("changes", "constraint"),
    [
        ({"state": "weird"}, "ck_punch_snapshots_state_known"),
        ({"state": "purged"}, "ck_punch_snapshots_purged_with_date"),
        ({"purged_at": utc_now()}, "ck_punch_snapshots_purged_with_date"),
        ({"brightness": 256}, "ck_punch_snapshots_brightness_in_range"),
        ({"brightness": -1}, "ck_punch_snapshots_brightness_in_range"),
        ({"width": 0}, "ck_punch_snapshots_size_positive"),
        ({"height": -5}, "ck_punch_snapshots_size_positive"),
        ({"size_bytes": -1}, "ck_punch_snapshots_size_positive"),
    ],
)
def test_the_database_refuses_an_inconsistent_snapshot(
    db_session: Session,
    kiosk: KioskDevice,
    worker_and_card: tuple[str, str],
    changes: dict[str, object],
    constraint: str,
) -> None:
    punch = make_punch(db_session, kiosk, worker_and_card)

    with pytest.raises(IntegrityError, match=constraint), db_session.begin_nested():
        make_snapshot(db_session, punch, **changes)


# --- Gate notices -----------------------------------------------------------------------------


@pytest.fixture
def author(db_session: Session) -> User:
    user = User(
        name="Test admin",
        username="notice.author",
        password_hash="x",
        role=Role.SUPER_ADMIN.value,
        is_active=True,
        must_change_password=False,
    )
    db_session.add(user)
    db_session.flush()
    return user


def make_notice(session: Session, author: User, **changes: object) -> KioskNotice:
    now = utc_now()
    values: dict[str, object] = {
        "plant_id": None,
        "text": "Helmet compulsory today",
        "level": "important",
        "starts_at": now,
        "ends_at": now + timedelta(hours=12),
        "created_by": author.id,
    }
    notice = KioskNotice(**{**values, **changes})
    session.add(notice)
    session.flush()
    return notice


def test_a_notice_for_all_plants_and_one_for_a_plant_are_valid(
    db_session: Session, author: User, k134: PlantIds
) -> None:
    everywhere = make_notice(db_session, author)
    one_plant = make_notice(db_session, author, plant_id=uuid.UUID(k134.id), level="normal")

    assert everywhere.plant_id is None
    assert one_plant.level == "normal"


def test_a_notice_can_be_ended_with_who_ended_it(db_session: Session, author: User) -> None:
    notice = make_notice(db_session, author)

    notice.ended_at = utc_now()
    notice.ended_by = author.id
    db_session.flush()

    assert notice.ended_by == author.id


@pytest.mark.parametrize(
    ("changes", "constraint"),
    [
        ({"text": ""}, "ck_kiosk_notices_text_length"),
        ({"text": "x" * 201}, "ck_kiosk_notices_text_length"),
        ({"level": "loud"}, "ck_kiosk_notices_level_known"),
        ({"ends_at": utc_now() - timedelta(hours=1)}, "ck_kiosk_notices_ends_after_start"),
        ({"ended_at": utc_now()}, "ck_kiosk_notices_ended_with_user"),
    ],
)
def test_the_database_refuses_an_inconsistent_notice(
    db_session: Session, author: User, changes: dict[str, object], constraint: str
) -> None:
    with pytest.raises(IntegrityError, match=constraint), db_session.begin_nested():
        make_notice(db_session, author, **changes)


def test_a_notice_of_exactly_200_characters_is_allowed(db_session: Session, author: User) -> None:
    notice = make_notice(db_session, author, text="x" * 200)

    assert len(notice.text) == 200


# --- Kiosk fields and indexes -----------------------------------------------------------------


def test_a_new_kiosk_has_its_sound_on_and_no_self_test_yet(
    db_session: Session, k134: PlantIds
) -> None:
    device = KioskDevice(plant_id=uuid.UUID(k134.id), name="New gate")
    db_session.add(device)
    db_session.flush()
    db_session.refresh(device)

    assert device.sound_muted is False
    assert device.last_self_test_at is None


def test_the_indexes_that_the_queries_rely_on_exist(db_session: Session) -> None:
    rows = db_session.execute(
        text(
            "SELECT indexname, indexdef FROM pg_indexes "
            "WHERE tablename IN ('punches', 'punch_snapshots', 'kiosk_notices')"
        )
    ).all()
    definitions = {name: definition for name, definition in rows}

    # M4: the punches that count (accepted and flagged) are looked up by punch time.
    counted = definitions["ix_punches_employee_counted"]
    assert "punch_time DESC" in counted
    assert "flagged" in counted.split("WHERE", 1)[1]
    assert "punch_time DESC" in definitions["ix_punches_card_recent"]
    assert "plant_id, punch_time" in definitions["ix_punches_plant_id_punch_time"]
    assert "plant_id, server_received_at" in definitions["ix_punches_plant_id_server_received_at"]
    assert (
        "state" in definitions["ix_punch_snapshots_due"].split("WHERE", 1)[1]
    )  # files still stored
    assert "ix_kiosk_notices_plant_window" in definitions
