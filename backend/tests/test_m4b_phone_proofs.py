"""Prove it is you, set your password, the notice and "Stop phone punching" (M4b spec §5.1, §5.2,
§7 rules 3, 5, 6, 20; AC-10 to AC-14, AC-16 to AC-19). Real PostgreSQL, fake face engine (person
1 is F-201's face, person 2 someone else). No real face is ever used."""

import hashlib
import time
import uuid
from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ApiError
from app.core.time import utc_now
from app.face.fake_engine import Problem
from app.modules.audit.models import AuditLog
from app.modules.phone.models import PhoneAccount, PhoneNoticeAcceptance, PhoneProof
from app.modules.phone.notice import raw_notice, require_notice_accepted
from app.modules.punches.models import PunchSnapshot
from app.modules.qr_cards.models import QrCredential
from app.modules.qr_cards.payload import build_payload
from app.modules.users.models import Role
from tests.clock_helpers import frozen_at, ist
from tests.conftest import clear_cached_settings
from tests.face_helpers import enrol, frame, new_employee, set_privacy
from tests.people_helpers import PlantIds, client_for, create_plant
from tests.phone_api_helpers import (
    FAR_AWAY,
    GOOD_PASSWORD,
    IPHONE_SAFARI,
    PHONE,
    People,
    card_proof,
    face_proof,
    give_password,
    make_people,
    phone_client,
    sessions_of,
    set_password,
    sign_in,
    switch_phone,
    turn_yaw,
)

NOTICE_V1_SHA256 = "517de0d5cbd1b31ab8e8fddf60d819005ebdf7beaa46056499b98c6a22501f9f"


@pytest.fixture(autouse=True)
def snapshot_folder(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("STORAGE_LOCAL_DIR", str(tmp_path / "snapshots"))
    clear_cached_settings()
    return tmp_path / "snapshots"


@pytest.fixture
def boss(db_app: FastAPI, db_session: Session) -> TestClient:
    set_privacy(db_session)
    return client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")


@pytest.fixture
def demo1(boss: TestClient, db_session: Session) -> PlantIds:
    return create_plant(boss, db_session, "DEMO1")


@pytest.fixture
def people(boss: TestClient, db_session: Session, demo1: PlantIds) -> People:
    found = make_people(boss, db_session, demo1)
    switch_phone(boss, found.face_id)
    switch_phone(boss, found.qr_id)
    return found


@pytest.fixture
def phone(db_app: FastAPI) -> TestClient:
    return phone_client(db_app)


def error_code(response) -> str:  # noqa: ANN001
    return response.json()["error"]["code"]


def account(session: Session, employee_id: str) -> PhoneAccount:
    session.expire_all()
    found = session.scalar(
        select(PhoneAccount).where(PhoneAccount.employee_id == uuid.UUID(employee_id))
    )
    assert found is not None
    return found


# --- Face proof ---------------------------------------------------------------------------------


def test_ac_10_face_proof_then_password_signs_in_and_keeps_no_picture(
    boss: TestClient,
    db_session: Session,
    people: People,
    phone: TestClient,
    snapshot_folder: Path,
) -> None:
    proof = face_proof(phone, "F-201", person=1)

    assert proof.status_code == 200, proof.text
    body = proof.json()
    assert len(body["proof_token"]) == 43
    assert body["employee"] == {"code": "F-201", "first_name": "Worker"}
    saved = set_password(phone, body["proof_token"])
    assert saved.status_code == 200, saved.text
    assert saved.json()["notice_required"] is True
    assert phone.get(f"{PHONE}/me").status_code == 200
    (row,) = sessions_of(db_session, people.face_id)
    assert row.sign_in_method == "proof"
    view = boss.get(f"/api/v1/employees/{people.face_id}/phone").json()
    assert view["account"]["state"] == "active" and view["account"]["proof_kind"] == "face"
    entry = db_session.scalars(
        select(AuditLog).where(AuditLog.action == "phone_account.password_set")
    ).one()
    assert entry.after == {"proof_kind": "face", "sessions_ended": 0}
    assert db_session.scalars(select(PunchSnapshot)).all() == []
    assert not snapshot_folder.exists() or not any(snapshot_folder.rglob("*"))


def test_ac_11_every_not_you_case_gives_the_same_answer_after_one_second(
    boss: TestClient, db_session: Session, people: People, phone: TestClient, demo1: PlantIds
) -> None:
    other_id = new_employee(boss, demo1, code="F-202")  # enrolled, phone punching OFF
    assert enrol(boss, other_id, person=2).status_code == 201
    cases = [("NOBODY-1", 1), ("Q-301", 1), ("F-202", 2), ("F-201", 2)]

    answers = []
    for code, person in cases:
        started = time.perf_counter()
        answer = face_proof(phone, code, person=person)
        answers.append((time.perf_counter() - started, answer))

    for seconds, answer in answers:
        assert answer.status_code == 401
        assert seconds >= 1.0
    assert len({str(answer.json()) for _, answer in answers}) == 1
    assert error_code(answers[0][1]) == "PROOF_FAILED"
    failed = db_session.scalars(
        select(AuditLog).where(AuditLog.action == "phone_proof.failed").order_by(AuditLog.at)
    ).all()
    assert [row.after for row in failed] == [{"kind": "face", "code": code} for code, _ in cases]


def test_a_printed_photo_fails_the_proof(people: People, phone: TestClient) -> None:
    answer = face_proof(phone, "F-201", person=1, problem=Problem.SPOOF)
    assert answer.status_code == 401 and error_code(answer) == "PROOF_FAILED"


def test_camera_problems_are_retry_hints_the_same_for_every_code(
    people: People, phone: TestClient
) -> None:
    for code in ("F-201", "NOBODY-1"):
        given = phone.post(f"{PHONE}/proof/face/challenge", json={"employee_code": code}).json()
        wrong_way = -turn_yaw(given["challenge"])
        answer = phone.post(
            f"{PHONE}/proof/face",
            json={
                "proof_id": given["proof_id"],
                "challenge_nonce": given["challenge_nonce"],
                "frames": [frame(1), frame(1, yaw=wrong_way, role="turn"), frame(1)],
            },
        )
        assert answer.status_code == 422
        assert answer.json()["error"]["code"] == "LIVENESS_FAILED"
        assert answer.json()["error"]["details"] == {"retry_allowed": True}


def test_a_challenge_is_used_once_and_expires(
    db_session: Session, people: People, phone: TestClient
) -> None:
    given = phone.post(f"{PHONE}/proof/face/challenge", json={"employee_code": "F-201"}).json()
    body = {
        "proof_id": given["proof_id"],
        "challenge_nonce": given["challenge_nonce"],
        "frames": [frame(1), frame(1, yaw=turn_yaw(given["challenge"]), role="turn"), frame(1)],
    }
    assert phone.post(f"{PHONE}/proof/face", json=body).status_code == 200
    again = phone.post(f"{PHONE}/proof/face", json=body)
    assert error_code(again) == "CHALLENGE_INVALID"

    late = phone.post(f"{PHONE}/proof/face/challenge", json={"employee_code": "F-201"}).json()
    row = db_session.get(PhoneProof, uuid.UUID(late["proof_id"]))
    assert row is not None
    row.issued_at = utc_now() - timedelta(seconds=60)
    row.expires_at = utc_now() - timedelta(seconds=30)
    db_session.commit()
    expired = phone.post(
        f"{PHONE}/proof/face",
        json=body | {"proof_id": late["proof_id"], "challenge_nonce": late["challenge_nonce"]},
    )
    assert error_code(expired) == "CHALLENGE_EXPIRED"


def test_the_challenge_does_not_tell_whether_a_code_exists(
    phone: TestClient, people: People
) -> None:
    known = phone.post(f"{PHONE}/proof/face/challenge", json={"employee_code": "F-201"})
    unknown = phone.post(f"{PHONE}/proof/face/challenge", json={"employee_code": "ZZ-999"})
    assert known.status_code == unknown.status_code == 200
    assert set(known.json()) == set(unknown.json())


def test_face_proofs_per_code_and_failed_proofs_from_everyone_are_limited(
    people: People, phone: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.phone.rate_limits import face_proof_code_limiter, failed_proof_limiter

    monkeypatch.setattr(face_proof_code_limiter, "_max_attempts", 1)
    assert face_proof(phone, "NOBODY-1", person=1).status_code == 401
    assert error_code(face_proof(phone, "NOBODY-1", person=1)) == "TOO_MANY_REQUESTS"

    monkeypatch.setattr(failed_proof_limiter, "_max_attempts", 1)
    blocked = phone.post(f"{PHONE}/proof/face/challenge", json={"employee_code": "F-201"})
    assert blocked.status_code == 429


def test_proofs_per_ip_are_limited(people: People, phone: TestClient) -> None:
    answers = [
        phone.post(f"{PHONE}/proof/face/challenge", json={"employee_code": "F-201"})
        for _ in range(11)
    ]
    assert [a.status_code for a in answers] == [200] * 10 + [429]


# --- Card proof ---------------------------------------------------------------------------------


def test_ac_12_card_proof_inside_the_fence_then_password(
    boss: TestClient, db_session: Session, people: People, phone: TestClient
) -> None:
    far = card_proof(phone, people.card_text, FAR_AWAY)
    assert far.status_code == 422 and error_code(far) == "OUTSIDE_GEOFENCE"

    proof = card_proof(phone, people.card_text)
    assert proof.status_code == 200, proof.text
    assert proof.json()["employee"] == {"code": "Q-301", "first_name": "Ramesh"}
    assert set_password(phone, proof.json()["proof_token"]).status_code == 200
    assert account(db_session, people.qr_id).proof_kind == "card"
    assert len(sessions_of(db_session, people.qr_id)) == 1


def test_ac_12_revoked_and_test_cards_and_bad_texts_fail_the_same_way(
    boss: TestClient, db_session: Session, people: People, phone: TestClient
) -> None:
    test_card = boss.post("/api/v1/qr-test-cards", json={"label": "Gate test"}).json()
    test_text = build_payload(get_settings(), test_card["serial"])
    serial = people.card_text.split(".")[2]
    card = db_session.scalars(select(QrCredential).where(QrCredential.card_serial == serial)).one()
    revoked = boss.post(
        f"/api/v1/qr-cards/{card.id}/revoke", json={"kind": "lost", "reason": "Lost it"}
    )
    assert revoked.status_code == 200, revoked.text

    answers = [
        card_proof(phone, people.card_text),
        card_proof(phone, test_text),
        card_proof(phone, "UPS1.A.C000001." + "A" * 103),
        card_proof(phone, "not a card"),
    ]
    assert {a.status_code for a in answers} == {401}
    assert {error_code(a) for a in answers} == {"PROOF_FAILED"}


def test_a_card_proof_needs_a_fresh_exact_location(people: People, phone: TestClient) -> None:
    old = card_proof(
        phone, people.card_text, {"lat": 19.85, "lon": 75.25, "accuracy_m": 10, "age_s": 90}
    )
    weak = card_proof(
        phone, people.card_text, {"lat": 19.85, "lon": 75.25, "accuracy_m": 80, "age_s": 1}
    )
    none = card_proof(phone, people.card_text, None)
    assert error_code(old) == "LOCATION_REQUIRED"
    assert error_code(weak) == "GPS_ACCURACY_TOO_LOW"
    assert error_code(none) == "LOCATION_REQUIRED"


def test_a_card_of_a_worker_with_phone_punching_off_fails(
    boss: TestClient, people: People, phone: TestClient
) -> None:
    switch_phone(boss, people.qr_id, on=False)
    assert error_code(card_proof(phone, people.card_text)) == "PROOF_FAILED"


# --- The proof token ----------------------------------------------------------------------------


def test_ac_13_a_proof_token_works_once_and_for_five_minutes(
    db_session: Session, people: People, phone: TestClient
) -> None:
    with frozen_at(ist(date(2026, 11, 2), 10, 0, 0)) as clock:
        first = card_proof(phone, people.card_text).json()["proof_token"]
        second = card_proof(phone, people.card_text).json()["proof_token"]
        clock.move_to(ist(date(2026, 11, 2), 10, 5, 1))
        late = set_password(phone, first)
        assert late.status_code == 401 and error_code(late) == "PROOF_TOKEN_INVALID"
        clock.move_to(ist(date(2026, 11, 2), 10, 4, 59))
        assert set_password(phone, second).status_code == 200
        reused = set_password(phone, second)
    assert error_code(reused) == "PROOF_TOKEN_INVALID"


def test_a_weak_password_does_not_use_up_the_token(people: People, phone: TestClient) -> None:
    token = card_proof(phone, people.card_text).json()["proof_token"]
    weak = set_password(phone, token, "12345678")
    assert weak.status_code == 422
    assert weak.json()["error"]["details"]["rule"] == "not_only_digits"
    assert set_password(phone, token).status_code == 200


def test_phone_switched_off_after_the_proof_refuses_the_password(
    boss: TestClient, people: People, phone: TestClient
) -> None:
    token = card_proof(phone, people.card_text).json()["proof_token"]
    switch_phone(boss, people.qr_id, on=False)
    answer = set_password(phone, token)
    assert answer.status_code == 403 and error_code(answer) == "PHONE_PUNCH_OFF"


def test_ac_14_a_reset_signs_out_the_other_phone(
    db_app: FastAPI, db_session: Session, people: People
) -> None:
    give_password(db_session, people.face_id, "Old-password-1")
    phone_a = phone_client(db_app)
    phone_b = phone_client(db_app, IPHONE_SAFARI)
    assert sign_in(phone_a, password="Old-password-1").status_code == 200

    token = face_proof(phone_b, "F-201", person=1).json()["proof_token"]
    assert set_password(phone_b, token).status_code == 200

    first, second = sessions_of(db_session, people.face_id)
    assert first.revoke_kind == "new_password" and second.revoked_at is None
    assert error_code(phone_a.get(f"{PHONE}/me")) == "PHONE_NOT_SIGNED_IN"
    assert error_code(sign_in(phone_a, password="Old-password-1")) == "PHONE_CREDENTIALS_INVALID"


def test_ac_16_a_locked_account_is_unlocked_by_a_proof(
    db_session: Session, people: People, phone: TestClient
) -> None:
    give_password(db_session, people.face_id, "Old-password-1")
    for n in range(5):
        sign_in(phone, password=f"Wrong-guess-{n}")
    assert error_code(sign_in(phone, password="Old-password-1")) == "PHONE_ACCOUNT_LOCKED"

    token = face_proof(phone, "F-201", person=1).json()["proof_token"]
    assert set_password(phone, token).status_code == 200

    assert account(db_session, people.face_id).locked_until is None
    assert sign_in(phone).status_code == 200


def test_ac_17_require_a_new_password_removes_it_and_the_proof_still_works(
    boss: TestClient, db_session: Session, people: People, phone: TestClient
) -> None:
    give_password(db_session, people.face_id, "Old-password-1")
    sign_in(phone, password="Old-password-1")

    answer = boss.post(
        f"/api/v1/employees/{people.face_id}/phone/require-new-password",
        json={"reason": "Shared the password"},
    )

    assert answer.status_code == 200, answer.text
    assert answer.json()["account"]["state"] == "new_password_required"
    assert account(db_session, people.face_id).password_hash is None
    assert [row.revoke_kind for row in sessions_of(db_session, people.face_id)] == ["new_password"]
    assert error_code(sign_in(phone, password="Old-password-1")) == "PHONE_CREDENTIALS_INVALID"
    token = face_proof(phone, "F-201", person=1).json()["proof_token"]
    assert set_password(phone, token).status_code == 200
    view = boss.get(f"/api/v1/employees/{people.face_id}/phone").json()
    assert view["account"]["state"] == "active"
    entry = db_session.scalars(
        select(AuditLog).where(AuditLog.action == "phone_account.new_password_required")
    ).one()
    assert entry.reason == "Shared the password"


# --- Notice -------------------------------------------------------------------------------------


def test_the_notice_text_v1_never_changes() -> None:
    assert hashlib.sha256(raw_notice().encode("utf-8")).hexdigest() == NOTICE_V1_SHA256
    assert "kiosk" not in raw_notice().lower()


def test_ac_18_no_punch_before_i_agree_then_the_exact_text_is_stored(
    db_session: Session, people: People, phone: TestClient
) -> None:
    give_password(db_session, people.face_id)
    sign_in(phone)
    employee_id = uuid.UUID(people.face_id)
    with pytest.raises(ApiError) as refused:
        require_notice_accepted(db_session, employee_id)
    assert refused.value.code == "PHONE_NOTICE_REQUIRED" and refused.value.status_code == 428
    assert phone.get(f"{PHONE}/me").json()["notice"] == {
        "required": True,
        "version": "phone-notice-v1",
    }

    shown = phone.get(f"{PHONE}/notice").json()
    assert "Tushar Gawande" in shown["text"] and "{{" not in shown["text"]
    changed = phone.post(
        f"{PHONE}/notice/accept", json={"version": shown["version"], "text_sha256": "0" * 64}
    )
    assert changed.status_code == 409 and error_code(changed) == "NOTICE_TEXT_CHANGED"
    accepted = phone.post(
        f"{PHONE}/notice/accept",
        json={"version": shown["version"], "text_sha256": shown["text_sha256"]},
    )

    assert accepted.status_code == 201, accepted.text
    row = db_session.scalars(select(PhoneNoticeAcceptance)).one()
    assert row.version == "phone-notice-v1" and row.language == "en"
    assert row.text_sha256 == hashlib.sha256(shown["text"].encode("utf-8")).hexdigest()
    assert row.session_id == sessions_of(db_session, people.face_id)[0].id
    require_notice_accepted(db_session, employee_id)  # no error now
    assert phone.get(f"{PHONE}/me").json()["notice"]["required"] is False
    again = phone.post(
        f"{PHONE}/notice/accept",
        json={"version": shown["version"], "text_sha256": shown["text_sha256"]},
    )
    assert again.json()["accepted_at"] == accepted.json()["accepted_at"]


def test_the_notice_needs_the_privacy_settings(
    db_session: Session, people: People, phone: TestClient
) -> None:
    from app.modules.settings.models import SettingValue

    give_password(db_session, people.face_id)
    sign_in(phone)
    db_session.merge(SettingValue(key="privacy_contact", value=""))
    db_session.commit()
    assert error_code(phone.get(f"{PHONE}/notice")) == "PRIVACY_CONTACT_MISSING"


# --- AC-19: stop phone punching -----------------------------------------------------------------


def test_ac_19_the_employee_stops_phone_punching_themselves(
    boss: TestClient, db_session: Session, people: People, phone: TestClient
) -> None:
    give_password(db_session, people.face_id)
    sign_in(phone)

    refused = phone.post(f"{PHONE}/stop", json={"confirm": False})
    stopped = phone.post(f"{PHONE}/stop", json={"confirm": True})

    assert refused.status_code == 422
    assert stopped.status_code == 204
    view = boss.get(f"/api/v1/employees/{people.face_id}/phone").json()
    assert view["phone_punch_enabled"] is False and view["phone_changed_by"] is None
    assert [row.revoke_kind for row in sessions_of(db_session, people.face_id)] == ["self_stop"]
    entry = db_session.scalars(
        select(AuditLog).where(AuditLog.action == "phone_access.self_disabled")
    ).one()
    assert entry.actor_type == "employee" and entry.actor_id == uuid.UUID(people.face_id)
    assert error_code(sign_in(phone)) == "PHONE_PUNCH_OFF"


# --- Me -----------------------------------------------------------------------------------------


def test_me_tells_the_phone_what_it_needs(
    boss: TestClient, db_session: Session, people: People, phone: TestClient
) -> None:
    boss.put(
        f"/api/v1/employees/{people.face_id}/phone/outside-work",
        json={"allowed": True, "reason": "Customer site", "until": date.today().isoformat()},
    )
    give_password(db_session, people.face_id)
    sign_in(phone)

    me = phone.get(f"{PHONE}/me").json()

    assert me["employee"]["first_name"] == "Worker" and me["employee"]["plant"]["code"] == "DEMO1"
    assert me["ready"] == {"face": True}
    assert me["access"]["outside_work_allowed"] is True
    assert me["today"] == {"last_punch": None}
    assert me["settings"]["gps_accuracy_limit_m"] == 50
    assert me["settings"]["location_max_age_seconds"] == 60
    assert me["geofence"]["shape"] == "circle" and me["geofence"]["buffer_m"] == 25
    assert me["passkeys"] == []


def test_audit_rows_never_hold_passwords_tokens_or_scores(
    db_session: Session, people: People, phone: TestClient
) -> None:
    token = face_proof(phone, "F-201", person=1).json()["proof_token"]
    set_password(phone, token)
    face_proof(phone, "F-201", person=2)
    text = " ".join(
        str((row.before, row.after, row.reason)) for row in db_session.scalars(select(AuditLog))
    )
    assert GOOD_PASSWORD not in text and token not in text
    assert "score" not in text and (phone.cookies.get("ups_phone") or "-") not in text


# --- Limits that one person cannot use to lock everyone out (review fix A1) -----------------------


def test_junk_card_proofs_do_not_block_face_proofs(
    people: People, phone: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.phone import proof_service
    from app.modules.phone.rate_limits import failed_proof_limiter

    monkeypatch.setattr(proof_service, "MIN_ANSWER_SECONDS", 0)
    monkeypatch.setattr(failed_proof_limiter, "_max_attempts", 2)
    for _ in range(5):
        junk = card_proof(phone, "not a card")
        assert error_code(junk) == "PROOF_FAILED"
    fine = phone.post(f"{PHONE}/proof/face/challenge", json={"employee_code": "F-201"})
    assert fine.status_code == 200


def test_a_flood_of_failed_face_proofs_still_blocks_everyone(
    people: People, phone: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.phone import proof_service
    from app.modules.phone.rate_limits import failed_proof_limiter

    monkeypatch.setattr(proof_service, "MIN_ANSWER_SECONDS", 0)
    monkeypatch.setattr(failed_proof_limiter, "_max_attempts", 2)
    for number in range(2):
        assert face_proof(phone, f"NOBODY-{number}", person=1).status_code == 401
    blocked = card_proof(phone, people.card_text)
    assert blocked.status_code == 429


def test_a_signed_card_that_keeps_being_refused_is_limited_per_card(
    boss: TestClient, people: People, phone: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.phone import proof_service
    from app.modules.phone.rate_limits import card_serial_failure_limiter

    monkeypatch.setattr(proof_service, "MIN_ANSWER_SECONDS", 0)
    monkeypatch.setattr(card_serial_failure_limiter, "_max_attempts", 2)
    switch_phone(boss, people.qr_id, on=False)
    answers = [card_proof(phone, people.card_text) for _ in range(3)]
    assert [a.status_code for a in answers] == [401, 401, 429]
