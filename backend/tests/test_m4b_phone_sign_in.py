"""Phone switches and employee sign-in (M4b spec §5.1, §5.5, §7 rules 1-4, 6-9; AC-1 to AC-9,
AC-15). Real PostgreSQL, fake face engine, frozen clock where time matters."""

import statistics
import time
import uuid
from datetime import date, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.time import IST, today_ist
from app.modules.audit.models import AuditLog
from app.modules.org.models import UserPlantAccess
from app.modules.phone.models import PhoneAccess, PhoneAccount
from app.modules.phone.passwords import check_employee_password
from app.modules.phone.rate_limits import phone_sign_in_limiter
from app.modules.phone.user_agent import phone_kind
from app.modules.settings.models import SettingValue
from app.modules.users.models import Role, User
from tests.clock_helpers import frozen_at, ist
from tests.face_helpers import set_privacy
from tests.people_helpers import PlantIds, client_for, create_plant
from tests.phone_api_helpers import (
    ANDROID_CHROME,
    GOOD_PASSWORD,
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

pytestmark = pytest.mark.time_sensitive

MONDAY = date(2026, 11, 2)  # the spec's day (§10)


@pytest.fixture
def boss(db_app: FastAPI, db_session: Session) -> TestClient:
    set_privacy(db_session)
    return client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")


@pytest.fixture
def demo1(boss: TestClient, db_session: Session) -> PlantIds:
    return create_plant(boss, db_session, "DEMO1")


@pytest.fixture
def people(boss: TestClient, db_session: Session, demo1: PlantIds) -> People:
    return make_people(boss, db_session, demo1)


@pytest.fixture
def phone(db_app: FastAPI) -> TestClient:
    return phone_client(db_app)


def audit_rows(session: Session, action: str) -> list[AuditLog]:
    return list(
        session.scalars(
            select(AuditLog).where(AuditLog.action == action).order_by(AuditLog.at, AuditLog.id)
        )
    )


def error_code(response) -> str:  # noqa: ANN001
    return response.json()["error"]["code"]


# --- AC-1, AC-2: the switches -------------------------------------------------------------------


def test_ac_1_super_admin_switches_phone_on_corporate_head_is_forbidden_plant_head_reads(
    boss: TestClient, db_app: FastAPI, db_session: Session, people: People, demo1: PlantIds
) -> None:
    answer = switch_phone(boss, people.face_id)

    assert answer.status_code == 200, answer.text
    assert answer.json()["phone_punch_enabled"] is True
    access = db_session.scalar(
        select(PhoneAccess).where(PhoneAccess.employee_id == uuid.UUID(people.face_id))
    )
    assert access is not None and access.phone_punch_enabled
    (entry,) = audit_rows(db_session, "phone_access.enable")
    assert entry.reason == "Site visits"

    corporate = client_for(db_app, db_session, Role.CORPORATE_HEAD, "corp")
    refused = corporate.put(
        f"/api/v1/employees/{people.face_id}/phone/access",
        json={"phone_punch_enabled": False, "reason": "No"},
    )
    assert refused.status_code == 403 and error_code(refused) == "FORBIDDEN"
    assert corporate.get(f"/api/v1/employees/{people.face_id}/phone").status_code == 200

    # A Plant Head of DEMO1 reads the card, without IP addresses.
    give_password(db_session, people.face_id)
    assert sign_in(phone_client(db_app)).status_code == 200
    head = client_for(db_app, db_session, Role.PLANT_HEAD, "head")
    head_user = db_session.scalars(select(User).where(User.username == "head")).one()
    db_session.add(UserPlantAccess(user_id=head_user.id, plant_id=uuid.UUID(demo1.id)))
    db_session.commit()
    read = head.get(f"/api/v1/employees/{people.face_id}/phone")
    assert read.status_code == 200, read.text
    assert read.json()["sessions"][0]["ip"] is None
    assert (
        boss.get(f"/api/v1/employees/{people.face_id}/phone").json()["sessions"][0]["browser"]
        == "Chrome"
    )
    changed = head.put(
        f"/api/v1/employees/{people.face_id}/phone/access",
        json={"phone_punch_enabled": False, "reason": "No"},
    )
    assert changed.status_code == 403


def test_switching_to_the_same_state_or_for_a_leaver_is_refused(
    boss: TestClient, people: People
) -> None:
    off_again = switch_phone(boss, people.face_id, on=False)
    assert off_again.status_code == 409 and error_code(off_again) == "PHONE_ACCESS_UNCHANGED"
    too_short = boss.put(
        f"/api/v1/employees/{people.face_id}/phone/access",
        json={"phone_punch_enabled": True, "reason": "  a "},
    )
    assert too_short.status_code == 422


def test_ac_2_outside_work_needs_phone_on_and_a_face_employee(
    boss: TestClient, people: People
) -> None:
    outside = f"/api/v1/employees/{people.face_id}/phone/outside-work"
    refused = boss.put(outside, json={"allowed": True, "reason": "Customer site"})
    assert refused.status_code == 409 and error_code(refused) == "PHONE_PUNCH_OFF"
    assert (
        boss.get(f"/api/v1/employees/{people.face_id}/phone").json()["outside_work_allowed"]
        is False
    )

    switch_phone(boss, people.qr_id)
    qr = boss.put(
        f"/api/v1/employees/{people.qr_id}/phone/outside-work",
        json={"allowed": True, "reason": "Customer site"},
    )
    assert qr.status_code == 409 and error_code(qr) == "EMPLOYEE_NOT_FACE"

    switch_phone(boss, people.face_id)
    allowed = boss.put(outside, json={"allowed": True, "reason": "Customer site"})
    assert allowed.status_code == 200 and allowed.json()["outside_work_allowed"] is True


# --- AC-3, AC-4: one answer, same timing --------------------------------------------------------


def test_ac_3_no_password_answers_like_a_wrong_password_in_about_the_same_time(
    boss: TestClient, db_session: Session, people: People, phone: TestClient
) -> None:
    switch_phone(boss, people.face_id)
    switch_phone(boss, people.qr_id)
    give_password(db_session, people.qr_id)
    # Six wrong passwords below: the lock (5 by default) must not answer instead.
    db_session.merge(SettingValue(key="phone_login_max_failures", value=10))
    db_session.commit()

    def timed(code: str) -> tuple[float, dict]:
        started = time.perf_counter()
        response = sign_in(phone, code, "Wrong-Password-1")
        return time.perf_counter() - started, response.json()

    timed("Q-301")  # warm up (first request of the app)
    no_password, wrong_password, unknown_code = [], [], []
    for _ in range(5):  # interleaved, so a slow moment of the machine hits all three
        no_password.append(timed("F-201"))
        wrong_password.append(timed("Q-301"))
        unknown_code.append(timed("NOBODY-9"))

    bodies = {str(body) for _, body in no_password + wrong_password + unknown_code}
    assert len(bodies) == 1 and "PHONE_CREDENTIALS_INVALID" in bodies.pop()
    reference = statistics.median(seconds for seconds, _ in wrong_password)
    for timings in (no_password, unknown_code):
        assert abs(statistics.median(s for s, _ in timings) - reference) <= 0.2 * reference


def test_ac_4_right_password_with_phone_off_makes_no_session(
    db_session: Session, people: People, phone: TestClient
) -> None:
    give_password(db_session, people.face_id)

    right = sign_in(phone)
    wrong = sign_in(phone, password="Not-the-password-1")

    assert right.status_code == 403 and error_code(right) == "PHONE_PUNCH_OFF"
    assert wrong.status_code == 401 and error_code(wrong) == "PHONE_CREDENTIALS_INVALID"
    assert sessions_of(db_session, people.face_id) == []


def test_a_left_employee_cannot_sign_in(
    boss: TestClient, db_session: Session, people: People, phone: TestClient
) -> None:
    switch_phone(boss, people.face_id)
    give_password(db_session, people.face_id)
    boss.post(
        f"/api/v1/employees/{people.face_id}/mark-left",
        json={"left_on": today_ist().isoformat(), "reason": "Contract ended"},
    )
    answer = sign_in(phone)
    assert answer.status_code == 401 and error_code(answer) == "PHONE_CREDENTIALS_INVALID"


# --- Sign-in success, cookie --------------------------------------------------------------------


def test_sign_in_sets_a_strict_httponly_secure_cookie_for_the_phone_path_only(
    boss: TestClient, db_session: Session, people: People, phone: TestClient
) -> None:
    switch_phone(boss, people.face_id)
    give_password(db_session, people.face_id)

    answer = sign_in(phone, code="f-201")  # codes are compared in capitals, as M1 does

    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["employee"]["code"] == "F-201" and body["employee"]["punch_method"] == "face"
    assert body["employee"]["plant"]["code"] == "DEMO1"
    assert body["notice_required"] is True
    cookie = answer.headers["set-cookie"]
    assert cookie.startswith("ups_phone=")
    for flag in ("HttpOnly", "Secure", "SameSite=strict", "Path=/api/v1/phone"):
        assert flag.lower() in cookie.lower()
    (row,) = sessions_of(db_session, people.face_id)
    assert row.token_hash != phone.cookies.get("ups_phone")
    assert (row.browser, row.system, row.sign_in_method) == ("Chrome", "Android", "password")
    entry = audit_rows(db_session, "phone_auth.login")[0]
    assert entry.actor_type == "employee" and entry.after == {
        "method": "password",
        "browser": "Chrome",
    }
    assert GOOD_PASSWORD not in str(entry.after)


def test_admin_cookie_never_works_on_phone_pages_and_phone_cookie_never_on_admin_pages(
    boss: TestClient, db_session: Session, people: People, phone: TestClient
) -> None:
    switch_phone(boss, people.face_id)
    give_password(db_session, people.face_id)
    sign_in(phone)

    assert boss.get(f"{PHONE}/me").status_code == 401
    admin_cookie = boss.cookies.get("ups_session")
    phone.cookies.set("ups_session", "forged")
    assert phone.get("/api/v1/auth/me").status_code == 401
    assert admin_cookie is not None
    forged = phone_client(boss.app)  # type: ignore[arg-type]
    made_up = forged.get(f"{PHONE}/me", headers={"Cookie": "ups_phone=made-up-token"})
    assert error_code(made_up) == "PHONE_NOT_SIGNED_IN"


def test_a_write_from_another_website_is_refused(
    boss: TestClient, db_session: Session, people: People, db_app: FastAPI
) -> None:
    switch_phone(boss, people.face_id)
    give_password(db_session, people.face_id)
    stranger = TestClient(
        db_app, base_url="https://testserver", headers={"Origin": "https://evil.example"}
    )
    assert error_code(sign_in(stranger)) == "ORIGIN_NOT_ALLOWED"


def test_logout_ends_the_sign_in_and_removes_the_cookie(
    boss: TestClient, db_session: Session, people: People, phone: TestClient
) -> None:
    switch_phone(boss, people.face_id)
    give_password(db_session, people.face_id)
    sign_in(phone)
    token = phone.cookies.get("ups_phone")

    assert phone.post(f"{PHONE}/logout").status_code == 204
    (row,) = sessions_of(db_session, people.face_id)
    assert row.revoke_kind == "logout"
    again = phone.get(f"{PHONE}/me", headers={"Cookie": f"ups_phone={token}"})
    assert again.json()["error"]["details"] == {"ended": "logout"}


# --- AC-5: one phone at a time ------------------------------------------------------------------


def test_ac_5_signing_in_on_phone_b_signs_out_phone_a(
    boss: TestClient, db_app: FastAPI, db_session: Session, people: People
) -> None:
    switch_phone(boss, people.face_id)
    give_password(db_session, people.face_id)
    phone_a = phone_client(db_app, ANDROID_CHROME)
    phone_b = phone_client(db_app, IPHONE_SAFARI)
    assert sign_in(phone_a).status_code == 200
    assert phone_a.get(f"{PHONE}/me").status_code == 200

    assert sign_in(phone_b).status_code == 200

    old = phone_a.get(f"{PHONE}/me")
    assert old.status_code == 401
    assert old.json()["error"] == {
        "code": "PHONE_NOT_SIGNED_IN",
        "message": "Please sign in again.",
        "details": {"ended": "new_login"},
    }
    first, second = sessions_of(db_session, people.face_id)
    assert first.revoke_kind == "new_login" and second.revoked_at is None
    assert phone_b.get(f"{PHONE}/me").status_code == 200


# --- AC-6: lockout with the frozen clock --------------------------------------------------------


def test_ac_6_five_wrong_passwords_lock_for_15_minutes_counted_in_whole_minutes_up(
    boss: TestClient, db_session: Session, people: People, phone: TestClient
) -> None:
    switch_phone(boss, people.face_id)
    give_password(db_session, people.face_id)
    with frozen_at(ist(MONDAY, 8, 0)) as clock:
        answers = [sign_in(phone, password=f"Wrong-guess-{n}") for n in range(5)]
        assert [error_code(a) for a in answers[:4]] == ["PHONE_CREDENTIALS_INVALID"] * 4
        assert answers[4].status_code == 423
        assert answers[4].json()["error"]["details"] == {"minutes_left": 15}

        clock.move_to(ist(MONDAY, 8, 5))
        locked = sign_in(phone)  # even the right password
        assert locked.status_code == 423
        assert locked.json()["error"]["details"] == {"minutes_left": 10}

        clock.move_to(ist(MONDAY, 8, 15, 1))
        assert sign_in(phone).status_code == 200
    account = db_session.scalar(
        select(PhoneAccount).where(PhoneAccount.employee_id == uuid.UUID(people.face_id))
    )
    assert account is not None and account.locked_until is None and account.failed_login_count == 0
    failures = audit_rows(db_session, "phone_auth.login_failed")
    assert len(failures) == 5 and failures[-1].after is not None
    assert all("Wrong-guess" not in str(row.after) for row in failures)


def test_a_locked_account_also_does_the_dummy_password_check(
    boss: TestClient,
    db_session: Session,
    people: People,
    phone: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.modules.phone import sign_in_service

    switch_phone(boss, people.face_id)
    give_password(db_session, people.face_id)
    calls: list[str] = []
    monkeypatch.setattr(sign_in_service, "dummy_password_check", calls.append)
    with frozen_at(ist(MONDAY, 8, 0)):
        for number in range(5):
            sign_in(phone, password=f"Wrong-guess-{number}")
        calls.clear()
        assert sign_in(phone).status_code == 423
    assert len(calls) == 1  # the time of a locked answer matches the other answers


# --- AC-7: switched off while signed in ---------------------------------------------------------


def test_ac_7_phone_off_ends_the_session_and_outside_work(
    boss: TestClient, db_session: Session, people: People, phone: TestClient
) -> None:
    switch_phone(boss, people.face_id)
    boss.put(
        f"/api/v1/employees/{people.face_id}/phone/outside-work",
        json={"allowed": True, "reason": "Customer site"},
    )
    give_password(db_session, people.face_id)
    sign_in(phone)

    off = switch_phone(boss, people.face_id, on=False)

    assert off.status_code == 200 and off.json()["outside_work_allowed"] is False
    answer = phone.get(f"{PHONE}/me")
    assert answer.status_code == 403 and error_code(answer) == "PHONE_PUNCH_OFF"
    (row,) = sessions_of(db_session, people.face_id)
    assert row.revoke_kind == "phone_off"
    (entry,) = audit_rows(db_session, "phone_access.disable")
    assert entry.after is not None and entry.after["outside_work_allowed"] is False


# --- AC-8: idle and absolute end ----------------------------------------------------------------


def test_ac_8_a_sign_in_ends_after_7_idle_days(
    boss: TestClient, db_session: Session, people: People, phone: TestClient
) -> None:
    switch_phone(boss, people.face_id)
    give_password(db_session, people.face_id)
    with frozen_at(ist(MONDAY, 9, 0)) as clock:
        sign_in(phone)
        clock.move_to(ist(MONDAY, 9, 0) + timedelta(days=7, minutes=-1))
        assert phone.get(f"{PHONE}/me").status_code == 200
        clock.move_to(ist(MONDAY, 9, 0) + timedelta(days=14, minutes=0))
        idle = phone.get(f"{PHONE}/me")
    assert idle.status_code == 401 and idle.json()["error"]["details"] == {"ended": "expired"}


def test_ac_8_a_sign_in_used_every_day_ends_30_days_after_it_started(
    boss: TestClient, db_session: Session, people: People, phone: TestClient
) -> None:
    switch_phone(boss, people.face_id)
    give_password(db_session, people.face_id)
    start = ist(MONDAY, 9, 0)
    with frozen_at(start) as clock:
        sign_in(phone)
        for day in range(1, 30):
            clock.move_to(start + timedelta(days=day))
            assert phone.get(f"{PHONE}/me").status_code == 200, day
        clock.move_to(start + timedelta(days=30, minutes=1))
        assert phone.get(f"{PHONE}/me").status_code == 401


def test_the_idle_rule_starts_again_after_each_use(
    boss: TestClient, db_session: Session, people: People, phone: TestClient
) -> None:
    switch_phone(boss, people.face_id)
    give_password(db_session, people.face_id)
    start = ist(MONDAY, 9, 0)
    with frozen_at(start) as clock:
        sign_in(phone)
        clock.move_to(start + timedelta(days=6))
        assert phone.get(f"{PHONE}/me").status_code == 200
        clock.move_to(start + timedelta(days=7, minutes=1))
        assert phone.get(f"{PHONE}/me").status_code == 200  # used on day 6


# --- AC-9: mark as left -------------------------------------------------------------------------


def test_ac_9_mark_as_left_ends_phone_access_sessions_and_password(
    boss: TestClient, db_session: Session, people: People, phone: TestClient
) -> None:
    switch_phone(boss, people.face_id)
    boss.put(
        f"/api/v1/employees/{people.face_id}/phone/outside-work",
        json={"allowed": True, "reason": "Customer site"},
    )
    give_password(db_session, people.face_id)
    sign_in(phone)

    left = boss.post(
        f"/api/v1/employees/{people.face_id}/mark-left",
        json={"left_on": today_ist().isoformat(), "reason": "Contract ended"},
    )

    assert left.status_code == 200, left.text
    db_session.expire_all()
    access = db_session.scalar(
        select(PhoneAccess).where(PhoneAccess.employee_id == uuid.UUID(people.face_id))
    )
    account = db_session.scalar(
        select(PhoneAccount).where(PhoneAccount.employee_id == uuid.UUID(people.face_id))
    )
    assert access is not None and not access.phone_punch_enabled
    assert not access.outside_work_allowed and access.phone_changed_by is None
    assert account is not None and account.password_hash is None
    assert [row.revoke_kind for row in sessions_of(db_session, people.face_id)] == ["left"]
    assert error_code(phone.get(f"{PHONE}/me")) == "PHONE_NOT_SIGNED_IN"
    reactivated = boss.post(
        f"/api/v1/employees/{people.face_id}/reactivate",
        json={"joined_on": today_ist().isoformat(), "reason": "Came back"},
    )
    assert reactivated.status_code == 200, reactivated.text
    view = boss.get(f"/api/v1/employees/{people.face_id}/phone").json()
    assert view["phone_punch_enabled"] is False and view["account"]["state"] == "no_password"


# --- Admin tools --------------------------------------------------------------------------------


def test_sign_out_all_phones_ends_every_sign_in_with_a_reason(
    boss: TestClient, db_session: Session, people: People, phone: TestClient
) -> None:
    switch_phone(boss, people.face_id)
    give_password(db_session, people.face_id)
    sign_in(phone)

    answer = boss.post(
        f"/api/v1/employees/{people.face_id}/phone/sign-out-all", json={"reason": "Lost phone"}
    )

    assert answer.json() == {"ended": 1}
    assert error_code(phone.get(f"{PHONE}/me")) == "PHONE_NOT_SIGNED_IN"
    (entry,) = audit_rows(db_session, "phone_account.sessions_ended")
    assert entry.reason == "Lost phone"


def test_the_admin_card_shows_the_locked_state(
    boss: TestClient, db_session: Session, people: People, phone: TestClient
) -> None:
    switch_phone(boss, people.face_id)
    give_password(db_session, people.face_id)
    for n in range(5):
        sign_in(phone, password=f"Wrong-guess-{n}")
    view = boss.get(f"/api/v1/employees/{people.face_id}/phone").json()
    assert view["account"]["state"] == "locked" and view["account"]["locked_until"]
    assert view["notice"] is None and view["sessions"] == []


# --- AC-15: password rules ----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("password", "rule"),
    [
        ("12345678", "not_only_digits"),
        ("F-201", "min_length"),
        ("f-201123", "too_common"),
        ("password123", "too_common"),
        ("abc", "min_length"),
        ("f-201@123", "too_common"),
        ("x" * 129, "max_length"),
    ],
)
def test_ac_15_weak_passwords_name_the_broken_rule(password: str, rule: str) -> None:
    with pytest.raises(ApiError) as refused:
        check_employee_password(password, "F-201")
    assert refused.value.code == "PASSWORD_TOO_WEAK"
    assert refused.value.details == {"rule": rule, "minimum_length": 8}


def test_ac_15_a_good_password_and_the_code_itself() -> None:
    check_employee_password("Ganesh@2026", "F-201")
    check_employee_password("my long pass phrase", "F-201")  # spaces are allowed
    with pytest.raises(ApiError) as refused:
        check_employee_password("ab-12345", "AB-12345")
    assert refused.value.details["rule"] == "not_employee_code"


# --- Rate limits, settings, browser names -------------------------------------------------------


def test_sign_ins_per_ip_are_limited_before_any_password_check(
    db_session: Session, people: People, phone: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(phone_sign_in_limiter, "_max_attempts", 3)
    answers = [sign_in(phone, password="Wrong-guess-1") for _ in range(4)]
    assert [a.status_code for a in answers] == [401, 401, 401, 429]
    assert error_code(answers[3]) == "TOO_MANY_REQUESTS"


def test_phone_settings_are_editable_and_checked_together(boss: TestClient) -> None:
    saved = boss.put(
        "/api/v1/settings",
        json={"values": {"phone_max_sessions": 2}, "reason": "Two phones for supervisors"},
    )
    assert saved.status_code == 200, saved.text
    refused = boss.put(
        "/api/v1/settings",
        json={"values": {"phone_session_max_days": 5}, "reason": "Shorter sign-ins"},
    )
    assert refused.status_code == 422 and error_code(refused) == "SETTING_INVALID"


def test_browser_and_system_names() -> None:
    assert phone_kind(ANDROID_CHROME).label == "Chrome on Android"
    assert phone_kind(IPHONE_SAFARI).label == "Safari on iOS"
    assert phone_kind(None).label == "Other on Other"


def test_frozen_clock_is_in_ist() -> None:
    assert ist(MONDAY, 8).tzinfo == IST
