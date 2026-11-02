"""Passkeys on the phone (F-80, M4b spec §5.1b, §7 rule 29; AC-54 to AC-56). A software passkey
(tests/passkey_helpers.py) signs with a real key; py_webauthn checks it for real."""

import uuid
from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.modules.audit.models import AuditLog
from app.modules.phone.models import PhoneAccount, PhonePasskey
from app.modules.phone.passkey_service import relying_party
from app.modules.users.models import Role
from tests.clock_helpers import frozen_at, ist
from tests.conftest import clear_cached_settings
from tests.face_helpers import set_privacy
from tests.passkey_helpers import SoftPasskey, b64url
from tests.people_helpers import PlantIds, client_for, create_plant
from tests.phone_api_helpers import (
    IPHONE_SAFARI,
    PHONE,
    People,
    give_password,
    make_people,
    phone_client,
    sessions_of,
    sign_in,
    switch_phone,
)

MONDAY = date(2026, 11, 2)


@pytest.fixture
def boss(db_app: FastAPI, db_session: Session) -> TestClient:
    set_privacy(db_session)
    return client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")


@pytest.fixture
def people(boss: TestClient, db_session: Session) -> People:
    plant: PlantIds = create_plant(boss, db_session, "DEMO1")
    found = make_people(boss, db_session, plant)
    switch_phone(boss, found.face_id)
    give_password(db_session, found.face_id)
    return found


@pytest.fixture
def phone(db_app: FastAPI) -> TestClient:
    return phone_client(db_app)


def error_code(response) -> str:  # noqa: ANN001
    return response.json()["error"]["code"]


def add_passkey(phone: TestClient, passkey: SoftPasskey):
    options = phone.post(f"{PHONE}/passkeys/register/options")
    assert options.status_code == 200, options.text
    return phone.post(
        f"{PHONE}/passkeys/register",
        json={"credential": passkey.register(options.json()["options"])},
    )


def passkey_sign_in(client: TestClient, passkey: SoftPasskey, code: str = "F-201", **answer):
    options = client.post(f"{PHONE}/passkeys/login/options", json={"employee_code": code})
    assert options.status_code == 200, options.text
    credential = passkey.sign_in(options.json()["options"], **answer)
    return client.post(
        f"{PHONE}/passkeys/login", json={"employee_code": code, "credential": credential}
    )


def passkeys_of(session: Session, employee_id: str) -> list[PhonePasskey]:
    session.expire_all()
    return list(
        session.scalars(
            select(PhonePasskey).where(PhonePasskey.employee_id == uuid.UUID(employee_id))
        )
    )


# --- AC-54: adding ------------------------------------------------------------------------------


def test_ac_54_a_passkey_is_added_within_ten_minutes_of_a_password_sign_in(
    db_session: Session, people: People, phone: TestClient
) -> None:
    with frozen_at(ist(MONDAY, 9, 0)) as clock:
        assert sign_in(phone).status_code == 200
        clock.move_to(ist(MONDAY, 9, 5))
        options = phone.post(f"{PHONE}/passkeys/register/options").json()["options"]
        assert options["authenticatorSelection"]["userVerification"] == "required"
        assert options["attestation"] == "none" and options["rp"]["id"] == "testserver"
        assert options["user"]["id"] != b64url(b"F-201")
        added = phone.post(
            f"{PHONE}/passkeys/register", json={"credential": SoftPasskey().register(options)}
        )
        assert added.status_code == 201, added.text
        assert added.json()["label"] == "Chrome on Android"

        clock.move_to(ist(MONDAY, 9, 20))
        late = phone.post(f"{PHONE}/passkeys/register/options")
    assert late.status_code == 403 and error_code(late) == "PHONE_RECENT_SIGN_IN_REQUIRED"
    (row,) = passkeys_of(db_session, people.face_id)
    assert row.sign_count == 0 and len(row.public_key) > 60 and len(row.user_handle) == 32
    assert row.transports == ["internal"]
    entry = db_session.scalars(select(AuditLog).where(AuditLog.action == "phone_passkey.add")).one()
    assert entry.after is not None and "public_key" not in str(entry.after)


def test_all_passkeys_of_one_employee_share_one_user_handle_and_three_is_the_limit(
    db_session: Session, people: People, phone: TestClient
) -> None:
    sign_in(phone)
    for _ in range(3):
        assert add_passkey(phone, SoftPasskey()).status_code == 201
    fourth = phone.post(f"{PHONE}/passkeys/register/options")
    assert fourth.status_code == 409 and error_code(fourth) == "PASSKEY_LIMIT_REACHED"
    handles = {row.user_handle for row in passkeys_of(db_session, people.face_id)}
    assert len(handles) == 1
    assert len(phone.get(f"{PHONE}/me").json()["passkeys"]) == 3


def test_a_registration_that_is_not_user_verified_or_reused_is_refused(
    people: People, phone: TestClient
) -> None:
    sign_in(phone)
    options = phone.post(f"{PHONE}/passkeys/register/options").json()["options"]
    unverified = phone.post(
        f"{PHONE}/passkeys/register",
        json={"credential": SoftPasskey().register(options, verified=False)},
    )
    assert unverified.status_code == 422 and error_code(unverified) == "PASSKEY_INVALID"
    reused = phone.post(
        f"{PHONE}/passkeys/register", json={"credential": SoftPasskey().register(options)}
    )
    assert error_code(reused) == "PASSKEY_INVALID"  # the challenge was used by the first try
    broken = phone.post(f"{PHONE}/passkeys/register", json={"credential": {"id": "x"}})
    assert error_code(broken) == "PASSKEY_INVALID"


# --- AC-55: signing in --------------------------------------------------------------------------


def test_ac_55_passkey_sign_in_works_like_a_password_sign_in(
    db_app: FastAPI, db_session: Session, people: People, phone: TestClient
) -> None:
    sign_in(phone)
    passkey = SoftPasskey()
    add_passkey(phone, passkey)
    other_phone = phone_client(db_app, IPHONE_SAFARI)

    answer = passkey_sign_in(other_phone, passkey)

    assert answer.status_code == 200, answer.text
    assert answer.json()["employee"]["code"] == "F-201"
    first, second = sessions_of(db_session, people.face_id)
    assert first.revoke_kind == "new_login" and second.sign_in_method == "passkey"
    (row,) = passkeys_of(db_session, people.face_id)
    assert row.sign_count == 1 and row.last_used_at is not None
    entry = db_session.scalars(
        select(AuditLog).where(AuditLog.action == "phone_auth.login").order_by(AuditLog.at.desc())
    ).first()
    assert entry is not None and entry.after is not None and entry.after["method"] == "passkey"
    # A passkey sign-in can never add another passkey (a borrowed session must not keep access).
    no_add = other_phone.post(f"{PHONE}/passkeys/register/options")
    assert error_code(no_add) == "PHONE_RECENT_SIGN_IN_REQUIRED"


def test_ac_55_bad_passkey_answers_are_one_answer_and_never_count_as_wrong_passwords(
    db_session: Session, people: People, phone: TestClient
) -> None:
    sign_in(phone)
    passkey = SoftPasskey()
    add_passkey(phone, passkey)
    assert passkey_sign_in(phone, passkey, count=5).status_code == 200

    answers = [
        passkey_sign_in(phone, passkey, count=3),  # the counter went back
        passkey_sign_in(phone, passkey, origin="https://evil.example"),
        passkey_sign_in(phone, passkey, challenge=b64url(b"a challenge nobody gave")),
        passkey_sign_in(phone, SoftPasskey()),  # a key this server never saw
        passkey_sign_in(phone, passkey, code="Q-301"),  # someone else's code
    ]

    assert {a.status_code for a in answers} == {401}
    assert {str(a.json()) for a in answers} == {str(answers[0].json())}
    assert error_code(answers[0]) == "PASSKEY_INVALID"
    account = db_session.scalar(
        select(PhoneAccount).where(PhoneAccount.employee_id == uuid.UUID(people.face_id))
    )
    assert account is not None and account.failed_login_count == 0
    assert passkeys_of(db_session, people.face_id)[0].removed_at is None  # the passkey stays
    failures = db_session.scalars(
        select(AuditLog).where(AuditLog.action == "phone_auth.login_failed")
    ).all()
    assert len(failures) == 5


def test_ac_55_passkey_sign_in_with_phone_punching_off(
    boss: TestClient, db_session: Session, people: People, phone: TestClient
) -> None:
    sign_in(phone)
    passkey = SoftPasskey()
    add_passkey(phone, passkey)
    # Switched off without the usual removal (e.g. a later change): the sign-in check still holds.
    from app.modules.phone.models import PhoneAccess

    access = db_session.scalars(select(PhoneAccess)).first()
    assert access is not None
    access.phone_punch_enabled = False
    db_session.commit()
    answer = passkey_sign_in(phone, passkey)
    assert answer.status_code == 403 and error_code(answer) == "PHONE_PUNCH_OFF"


def test_unknown_codes_get_options_of_the_same_shape(people: People, phone: TestClient) -> None:
    known = phone.post(f"{PHONE}/passkeys/login/options", json={"employee_code": "F-201"})
    unknown = phone.post(f"{PHONE}/passkeys/login/options", json={"employee_code": "ZZ-1"})
    assert known.status_code == unknown.status_code == 200
    assert set(known.json()["options"]) == set(unknown.json()["options"])
    assert unknown.json()["options"]["userVerification"] == "required"
    # A code with no passkey (known or not) lists one made-up key id, the same one every time.
    known_ids = [item["id"] for item in known.json()["options"]["allowCredentials"]]
    unknown_ids = [item["id"] for item in unknown.json()["options"]["allowCredentials"]]
    again = phone.post(f"{PHONE}/passkeys/login/options", json={"employee_code": "ZZ-1"})
    assert len(known_ids) == len(unknown_ids) == 1 and known_ids != unknown_ids
    assert [i["id"] for i in again.json()["options"]["allowCredentials"]] == unknown_ids


# --- AC-56: removal -----------------------------------------------------------------------------


def test_ac_56_require_new_password_and_phone_off_remove_every_passkey(
    boss: TestClient, db_session: Session, people: People, phone: TestClient
) -> None:
    sign_in(phone)
    passkey = SoftPasskey()
    add_passkey(phone, passkey)

    boss.post(
        f"/api/v1/employees/{people.face_id}/phone/require-new-password",
        json={"reason": "Shared the password"},
    )

    (row,) = passkeys_of(db_session, people.face_id)
    assert row.remove_kind == "new_password" and row.removed_at is not None
    assert error_code(passkey_sign_in(phone, passkey)) == "PASSKEY_INVALID"

    give_password(db_session, people.face_id)
    sign_in(phone)
    second = SoftPasskey()
    add_passkey(phone, second)
    switch_phone(boss, people.face_id, on=False)
    kinds = sorted(row.remove_kind or "" for row in passkeys_of(db_session, people.face_id))
    assert kinds == ["new_password", "phone_off"]


def test_the_employee_and_the_super_admin_remove_one_passkey(
    boss: TestClient, db_session: Session, people: People, phone: TestClient
) -> None:
    sign_in(phone)
    add_passkey(phone, SoftPasskey())
    add_passkey(phone, SoftPasskey())
    first, second = passkeys_of(db_session, people.face_id)

    assert phone.delete(f"{PHONE}/passkeys/{first.id}").status_code == 204
    assert phone.delete(f"{PHONE}/passkeys/{first.id}").status_code == 404
    by_admin = boss.post(
        f"/api/v1/employees/{people.face_id}/phone/passkeys/{second.id}/remove",
        json={"reason": "Phone was sold"},
    )
    assert by_admin.status_code == 204
    kinds = {row.id: row.remove_kind for row in passkeys_of(db_session, people.face_id)}
    assert kinds == {first.id: "self", second.id: "admin"}
    assert phone.get(f"{PHONE}/passkeys").json() == []


def test_passkeys_need_the_public_origin_outside_development(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_PUBLIC_ORIGIN", "")
    clear_cached_settings()
    with pytest.raises(ApiError) as refused:
        relying_party()
    assert refused.value.code == "PASSKEYS_NOT_CONFIGURED" and refused.value.status_code == 503
    monkeypatch.setenv("APP_PUBLIC_ORIGIN", "https://upasthiti-chi.vercel.app/")
    clear_cached_settings()
    assert relying_party() == ("upasthiti-chi.vercel.app", "https://upasthiti-chi.vercel.app")
