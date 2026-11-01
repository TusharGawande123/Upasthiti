"""M4b database rules (migrations 0026 and 0027): the phone tables and the phone columns of
punches, challenges and snapshots refuse impossible rows. Real PostgreSQL, fake data."""

import hashlib
import uuid
from datetime import timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import Session

from app.core.time import utc_now
from app.modules.kiosks.models import KioskDevice
from app.modules.notifications.models import Notification
from app.modules.phone.models import (
    PhoneAccess,
    PhoneAccount,
    PhoneNoticeAcceptance,
    PhonePasskey,
    PhoneProof,
    PhoneSession,
)
from app.modules.punches.models import Punch, PunchChallenge
from app.modules.users.models import Role
from tests.people_helpers import PlantIds, client_for, create_plant, temporary_body
from tests.phone_helpers import make_phone_punch, make_phone_session
from tests.test_punch_tables import make_punch, make_snapshot


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


@pytest.fixture
def employee_id(worker_and_card: tuple[str, str]) -> uuid.UUID:
    return uuid.UUID(worker_and_card[0])


@pytest.fixture
def phone_session(db_session: Session, employee_id: uuid.UUID) -> PhoneSession:
    return make_phone_session(db_session, employee_id)


def refused(session: Session, row: object) -> None:
    """The row breaks a database rule: adding it fails, and the test goes on afterwards."""
    with pytest.raises(IntegrityError), session.begin_nested():
        session.add(row)
        session.flush()


def sha() -> str:
    return hashlib.sha256(uuid.uuid4().bytes).hexdigest()


# --- Migration 0026: the phone tables ------------------------------------------------------------


def test_outside_work_needs_phone_punching_on(db_session: Session, employee_id: uuid.UUID) -> None:
    now = utc_now()
    refused(
        db_session,
        PhoneAccess(
            employee_id=employee_id,
            phone_punch_enabled=False,
            outside_work_allowed=True,
            phone_changed_at=now,
        ),
    )
    access = PhoneAccess(
        employee_id=employee_id,
        phone_punch_enabled=True,
        outside_work_allowed=True,
        phone_changed_at=now,
    )
    db_session.add(access)
    db_session.flush()
    # One row per employee.
    refused(db_session, PhoneAccess(employee_id=employee_id, phone_changed_at=now))


def test_a_password_always_has_its_date(db_session: Session, employee_id: uuid.UUID) -> None:
    refused(db_session, PhoneAccount(employee_id=employee_id, password_hash="$argon2id$x"))
    refused(db_session, PhoneAccount(employee_id=employee_id, proof_kind="otp"))
    account = PhoneAccount(
        employee_id=employee_id,
        password_hash="$argon2id$x",
        password_set_at=utc_now(),
        proof_kind="card",
    )
    db_session.add(account)
    db_session.flush()
    assert account.failed_login_count == 0


def test_a_session_end_has_a_kind_and_a_known_one(
    db_session: Session, employee_id: uuid.UUID
) -> None:
    def ended(**changes: object) -> PhoneSession:
        now = utc_now()
        values: dict[str, object] = {
            "employee_id": employee_id,
            "token_hash": sha(),
            "created_at": now,
            "last_seen_at": now,
            "expires_at": now + timedelta(days=30),
            "browser": "Chrome",
            "system": "Android",
        }
        return PhoneSession(**{**values, **changes})

    refused(db_session, ended(revoked_at=utc_now()))
    refused(db_session, ended(revoked_at=utc_now(), revoke_kind="stolen"))
    refused(db_session, ended(token_hash="NOT-A-HASH"))
    refused(db_session, ended(expires_at=utc_now() - timedelta(days=1)))
    db_session.add(ended(revoked_at=utc_now(), revoke_kind="self_stop"))
    db_session.flush()


def test_a_notice_acceptance_is_never_changed(
    db_session: Session, employee_id: uuid.UUID, phone_session: PhoneSession
) -> None:
    acceptance = PhoneNoticeAcceptance(
        employee_id=employee_id,
        version="2026-11",
        language="en",
        text_sha256=sha(),
        accepted_at=utc_now(),
        session_id=phone_session.id,
    )
    db_session.add(acceptance)
    db_session.flush()
    refused(
        db_session,
        PhoneNoticeAcceptance(
            employee_id=employee_id,
            version="2026-11",
            language="en",
            text_sha256=sha(),
            accepted_at=utc_now(),
            session_id=phone_session.id,
        ),
    )
    for statement in (
        "UPDATE phone_notice_acceptances SET language = 'mr' WHERE id = :id",
        "DELETE FROM phone_notice_acceptances WHERE id = :id",
    ):
        with pytest.raises(DBAPIError, match="append-only"), db_session.begin_nested():
            db_session.execute(text(statement), {"id": acceptance.id})


def test_a_passkey_has_a_32_byte_handle_and_a_known_removal(
    db_session: Session, employee_id: uuid.UUID
) -> None:
    def passkey(**changes: object) -> PhonePasskey:
        values: dict[str, object] = {
            "employee_id": employee_id,
            "credential_id": uuid.uuid4().bytes,
            "public_key": b"cose",
            "user_handle": b"h" * 32,
            "label": "Chrome on Android",
            "created_at": utc_now(),
        }
        return PhonePasskey(**{**values, **changes})

    refused(db_session, passkey(user_handle=b"short"))
    refused(db_session, passkey(removed_at=utc_now()))
    refused(db_session, passkey(removed_at=utc_now(), remove_kind="lost"))
    kept = passkey(removed_at=utc_now(), remove_kind="self")
    db_session.add(kept)
    db_session.flush()
    refused(db_session, passkey(credential_id=kept.credential_id))


def test_a_proof_has_a_known_kind_and_a_token_with_an_end(db_session: Session) -> None:
    def proof(**changes: object) -> PhoneProof:
        now = utc_now()
        values: dict[str, object] = {
            "kind": "face",
            "claimed_code": "1043",
            "challenge": "turn_left",
            "nonce_sha256": sha(),
            "issued_at": now,
            "expires_at": now + timedelta(minutes=2),
        }
        return PhoneProof(**{**values, **changes})

    refused(db_session, proof(kind="sms"))
    refused(db_session, proof(result="maybe"))
    refused(db_session, proof(challenge="blink"))
    refused(db_session, proof(token_sha256=sha()))
    refused(db_session, proof(token_used_at=utc_now()))
    db_session.add(proof(result="passed", token_sha256=sha(), token_expires_at=utc_now()))
    db_session.flush()


def test_the_many_phones_notification_kind_is_known(db_session: Session) -> None:
    db_session.add(
        Notification(
            kind="phone_many_phones",
            severity="warning",
            text_key="notification.phone_many_phones",
            params={"count": 4},
            subject_ids=[],
            link="/admin/employees",
            dedupe_key=f"phone_many_phones:{uuid.uuid4()}",
            created_at=utc_now(),
        )
    )
    db_session.flush()


def test_new_phone_tables_have_row_level_security(db_session: Session) -> None:
    rows = db_session.execute(
        text(
            "SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' "
            "AND tablename LIKE 'phone%'"
        )
    ).all()
    assert sorted(rows) == [
        ("phone_access", True),
        ("phone_accounts", True),
        ("phone_notice_acceptances", True),
        ("phone_passkeys", True),
        ("phone_proofs", True),
        ("phone_sessions", True),
    ]


# --- Migration 0027: phone punches ---------------------------------------------------------------


def test_a_phone_face_punch_has_no_gate_device(
    db_session: Session, k134: PlantIds, phone_session: PhoneSession
) -> None:
    punch = make_phone_punch(db_session, phone_session, uuid.UUID(k134.id))
    stored = db_session.get(Punch, punch.id)
    assert stored is not None
    assert stored.kiosk_id is None and stored.channel == "phone"
    assert stored.device_key == ("phone", phone_session.id)


def test_a_gate_punch_is_a_kiosk_punch_by_default(
    db_session: Session, kiosk: KioskDevice, worker_and_card: tuple[str, str]
) -> None:
    punch = make_punch(db_session, kiosk, worker_and_card)
    db_session.expire(punch)
    assert punch.channel == "kiosk"
    assert punch.location_plant_id is None and punch.phone_session_id is None
    assert punch.device_key == ("kiosk", kiosk.id)


def test_impossible_phone_and_gate_rows_are_refused(
    db_session: Session,
    k134: PlantIds,
    kiosk: KioskDevice,
    worker_and_card: tuple[str, str],
    phone_session: PhoneSession,
) -> None:
    plant_id = uuid.UUID(k134.id)
    employee_id = uuid.UUID(worker_and_card[0])

    def phone_row(**changes: object) -> Punch:
        values: dict[str, object] = {
            "client_punch_id": uuid.uuid4(),
            "channel": "phone",
            "phone_session_id": phone_session.id,
            "plant_id": plant_id,
            "employee_id": employee_id,
            "method": "face",
            "match_mode": "one_to_one",
            "direction": "in",
            "decision": "accepted",
            "reason_codes": [],
            "server_received_at": utc_now(),
        }
        return Punch(**{**values, **changes})

    refused(db_session, phone_row(channel="sms"))
    refused(db_session, phone_row(phone_session_id=None))  # a phone punch needs its sign-in
    refused(db_session, phone_row(channel="kiosk"))  # a gate punch needs its device
    refused(db_session, phone_row(channel="kiosk", kiosk_id=kiosk.id))  # ... and no sign-in
    refused(db_session, phone_row(method="gate_code", match_mode=None))  # a code needs the gate
    refused(db_session, phone_row(method="selfie", match_mode=None))
    refused(
        db_session,
        phone_row(
            decision="flagged",
            reason_codes=["OUTSIDE_PLANT"],
            location_plant_id=plant_id,  # outside every fence, so no matched plant
        ),
    )
    with pytest.raises(IntegrityError), db_session.begin_nested():
        make_punch(db_session, kiosk, worker_and_card, match_mode="one_to_one", method="face")

    # The good ones.
    make_phone_punch(
        db_session,
        phone_session,
        plant_id,
        method="gate_code",
        match_mode=None,
        kiosk_id=kiosk.id,
    )
    make_phone_punch(
        db_session,
        phone_session,
        plant_id,
        decision="flagged",
        reason_codes=["OUTSIDE_PLANT"],
        location_plant_id=None,
    )


def test_a_phone_retry_with_the_same_id_is_refused_but_other_sign_ins_may_reuse_it(
    db_session: Session, k134: PlantIds, employee_id: uuid.UUID, phone_session: PhoneSession
) -> None:
    plant_id = uuid.UUID(k134.id)
    first = make_phone_punch(db_session, phone_session, plant_id)
    with pytest.raises(IntegrityError), db_session.begin_nested():
        make_phone_punch(db_session, phone_session, plant_id, client_punch_id=first.client_punch_id)
    other = make_phone_session(db_session, employee_id)
    make_phone_punch(db_session, other, plant_id, client_punch_id=first.client_punch_id)


def test_a_phone_punch_stays_append_only(
    db_session: Session, k134: PlantIds, phone_session: PhoneSession
) -> None:
    punch = make_phone_punch(db_session, phone_session, uuid.UUID(k134.id))
    with pytest.raises(DBAPIError, match="append-only"), db_session.begin_nested():
        db_session.execute(
            text("UPDATE punches SET channel = 'kiosk' WHERE id = :id"), {"id": punch.id}
        )


def test_a_challenge_belongs_to_one_device_or_one_sign_in(
    db_session: Session, kiosk: KioskDevice, phone_session: PhoneSession
) -> None:
    def challenge(**owner: object) -> PunchChallenge:
        now = utc_now()
        return PunchChallenge(
            nonce_sha256=sha(),
            challenge="turn_left",
            issued_at=now,
            expires_at=now + timedelta(seconds=60),
            **owner,
        )

    refused(db_session, challenge())
    refused(db_session, challenge(kiosk_id=kiosk.id, phone_session_id=phone_session.id))
    db_session.add(challenge(kiosk_id=kiosk.id))
    db_session.add(challenge(phone_session_id=phone_session.id))
    db_session.flush()


def test_phone_photos_have_their_own_reasons(
    db_session: Session, k134: PlantIds, kiosk: KioskDevice, phone_session: PhoneSession
) -> None:
    plant_id = uuid.UUID(k134.id)
    rejected = make_phone_punch(
        db_session,
        phone_session,
        plant_id,
        decision="rejected",
        reason_codes=["FACE_NOT_RECOGNISED"],
        direction=None,
        match_mode=None,
        employee_id=None,
        claimed_employee_id=phone_session.employee_id,
    )
    code_punch = make_phone_punch(
        db_session, phone_session, plant_id, method="gate_code", match_mode=None, kiosk_id=kiosk.id
    )
    make_snapshot(db_session, rejected, reason="phone_face_rejected")
    make_snapshot(db_session, code_punch, reason="phone_gate_code")
    with pytest.raises(IntegrityError), db_session.begin_nested():
        other = make_phone_punch(db_session, phone_session, plant_id)
        make_snapshot(db_session, other, reason="phone_selfie")
