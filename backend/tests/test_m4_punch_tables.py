"""M4 database rules: flagged punches, offline columns, punch time and append-only reviews
(spec M4 section 6, AC-5). These talk to a real PostgreSQL."""

import uuid
from datetime import timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import Session

from app.core.time import utc_now
from app.modules.kiosks.models import KioskDevice
from app.modules.punches.models import Punch, PunchReview
from app.modules.users.models import Role, User
from tests.people_helpers import PlantIds, client_for, create_plant, temporary_body
from tests.test_punch_tables import make_punch


@pytest.fixture
def boss(db_app: FastAPI, db_session: Session) -> TestClient:
    return client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")


@pytest.fixture
def boss_user(db_session: Session, boss: TestClient) -> User:
    return db_session.scalars(select(User).where(User.username == "boss")).one()


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


def offline_values(**changes: object) -> dict[str, object]:
    received = utc_now()
    values: dict[str, object] = {
        "was_offline": True,
        "server_received_at": received,
        "offline_punch_time": received - timedelta(hours=1),
        "time_proof": "anchored",
        "device_counter": 41,
    }
    return {**values, **changes}


def make_review(session: Session, punch: Punch, user: User, **changes: object) -> PunchReview:
    values: dict[str, object] = {
        "punch_id": punch.id,
        "action": "confirmed",
        "employee_id": punch.employee_id,
        "reviewed_by": user.id,
        "reviewed_at": utc_now(),
    }
    review = PunchReview(**{**values, **changes})
    session.add(review)
    session.flush()
    return review


# --- Punches ----------------------------------------------------------------------------------


def test_a_flagged_punch_keeps_its_flag_codes_and_a_direction(
    db_session: Session, kiosk: KioskDevice, worker_and_card: tuple[str, str]
) -> None:
    punch = make_punch(
        db_session,
        kiosk,
        worker_and_card,
        decision="flagged",
        reason_codes=["LOCATION_AT_EDGE", "TWO_DEVICES_SOON"],
    )

    db_session.refresh(punch)
    assert punch.decision == "flagged"
    assert punch.reason_codes == ["LOCATION_AT_EDGE", "TWO_DEVICES_SOON"]


def test_the_punch_time_is_the_server_time_online_and_the_proven_time_offline(
    db_session: Session, kiosk: KioskDevice, worker_and_card: tuple[str, str]
) -> None:
    online = make_punch(db_session, kiosk, worker_and_card)
    offline = make_punch(db_session, kiosk, worker_and_card, **offline_values())

    db_session.refresh(online)
    db_session.refresh(offline)
    assert online.punch_time == online.server_received_at
    assert offline.punch_time == offline.offline_punch_time


@pytest.mark.parametrize(
    ("changes", "constraint"),
    [
        (
            {"decision": "flagged", "reason_codes": ["LOCATION_AT_EDGE"], "direction": None},
            "accepted_has_direction",
        ),
        ({"decision": "flagged", "reason_codes": []}, "reason_codes_match_decision"),
        ({"was_offline": True}, "offline_has_time"),
        ({"offline_punch_time": utc_now()}, "offline_has_time"),
        (offline_values(time_proof=None), "time_proof_only_offline"),
        ({"time_proof": "anchored"}, "time_proof_only_offline"),
        (offline_values(time_proof="guessed"), "time_proof_known"),
        ({"device_counter": 7}, "device_counter_only_offline"),
        ({"location_age_s": -1}, "location_age_in_range"),
        ({"location_age_s": 604_801}, "location_age_in_range"),
        ({"geofence_distance_m": -0.5}, "geofence_distance_not_negative"),
    ],
)
def test_the_database_refuses_an_inconsistent_m4_punch(
    db_session: Session,
    kiosk: KioskDevice,
    worker_and_card: tuple[str, str],
    changes: dict[str, object],
    constraint: str,
) -> None:
    with pytest.raises(IntegrityError, match=constraint), db_session.begin_nested():
        make_punch(db_session, kiosk, worker_and_card, **changes)


def test_an_offline_counter_can_be_used_only_once_per_device(
    db_session: Session, kiosk: KioskDevice, worker_and_card: tuple[str, str]
) -> None:
    make_punch(db_session, kiosk, worker_and_card, **offline_values(device_counter=9))

    refusal = pytest.raises(IntegrityError, match="uq_punches_kiosk_device_counter")
    with refusal, db_session.begin_nested():
        make_punch(db_session, kiosk, worker_and_card, **offline_values(device_counter=9))


def test_punches_stay_append_only_after_the_m4_columns(
    db_session: Session, kiosk: KioskDevice, worker_and_card: tuple[str, str]
) -> None:
    make_punch(db_session, kiosk, worker_and_card)

    with pytest.raises(DBAPIError, match="append-only"), db_session.begin_nested():
        db_session.execute(text("UPDATE punches SET related_punch_id = id"))


# --- Reviews ----------------------------------------------------------------------------------


def test_a_review_and_its_replacement_are_both_kept(
    db_session: Session, kiosk: KioskDevice, worker_and_card: tuple[str, str], boss_user: User
) -> None:
    punch = make_punch(
        db_session, kiosk, worker_and_card, decision="flagged", reason_codes=["LOCATION_AT_EDGE"]
    )
    first = make_review(db_session, punch, boss_user)
    second = make_review(
        db_session,
        punch,
        boss_user,
        action="not_accepted",
        reason="Card used by someone else",
        supersedes_review_id=first.id,
    )

    rows = db_session.scalars(select(PunchReview).where(PunchReview.punch_id == punch.id)).all()
    assert {row.id for row in rows} == {first.id, second.id}


def test_a_review_is_replaced_at_most_once(
    db_session: Session, kiosk: KioskDevice, worker_and_card: tuple[str, str], boss_user: User
) -> None:
    punch = make_punch(
        db_session, kiosk, worker_and_card, decision="flagged", reason_codes=["LOCATION_AT_EDGE"]
    )
    first = make_review(db_session, punch, boss_user)
    make_review(db_session, punch, boss_user, supersedes_review_id=first.id)

    refusal = pytest.raises(IntegrityError, match="uq_punch_reviews_supersedes_review_id")
    with refusal, db_session.begin_nested():
        make_review(db_session, punch, boss_user, supersedes_review_id=first.id)


@pytest.mark.parametrize(
    ("changes", "constraint"),
    [
        ({"action": "maybe"}, "action_known"),
        ({"action": "approved"}, "direction_only_for_approved"),
        ({"action": "confirmed", "direction": "in"}, "direction_only_for_approved"),
        ({"action": "not_accepted"}, "reason_required"),
        ({"action": "not_accepted", "reason": "  x "}, "reason_required"),
        ({"action": "approved", "direction": "in", "reason": "ok"}, "reason_required"),
        ({"reason": "x" * 301}, "reason_length"),
        ({"action": "approved", "direction": "up", "reason": "Genuine"}, "direction_known"),
    ],
)
def test_the_database_refuses_an_inconsistent_review(
    db_session: Session,
    kiosk: KioskDevice,
    worker_and_card: tuple[str, str],
    boss_user: User,
    changes: dict[str, object],
    constraint: str,
) -> None:
    punch = make_punch(
        db_session,
        kiosk,
        worker_and_card,
        decision="rejected",
        reason_codes=["OUTSIDE_GEOFENCE"],
        direction=None,
    )

    with pytest.raises(IntegrityError, match=constraint), db_session.begin_nested():
        make_review(db_session, punch, boss_user, **changes)


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE punch_reviews SET reason = 'changed'",
        "DELETE FROM punch_reviews",
        "TRUNCATE punch_reviews",
    ],
)
def test_the_database_refuses_to_change_or_delete_a_review(
    db_session: Session,
    kiosk: KioskDevice,
    worker_and_card: tuple[str, str],
    boss_user: User,
    statement: str,
) -> None:
    punch = make_punch(
        db_session, kiosk, worker_and_card, decision="flagged", reason_codes=["IMPOSSIBLE_TRAVEL"]
    )
    make_review(db_session, punch, boss_user)

    with pytest.raises(DBAPIError, match="append-only"), db_session.begin_nested():
        db_session.execute(text(statement))
