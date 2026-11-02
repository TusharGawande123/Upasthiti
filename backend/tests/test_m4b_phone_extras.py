"""M4b approved extras that belong to slice P1 (spec §7 rules 3, 9, 25, 27; AC-49, AC-50, AC-59)
and the clean-up job of the phone tables. Real PostgreSQL, frozen clock."""

import threading
import time
import uuid
from datetime import date, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import today_ist, utc_now
from app.jobs.daily import run_daily_jobs
from app.modules.audit.models import AuditLog
from app.modules.auth.passwords import hash_password
from app.modules.employees.models import Employee
from app.modules.notifications.models import Notification
from app.modules.phone import sign_in_service
from app.modules.phone.access import access_of, outside_work_allowed_on
from app.modules.phone.cleanup import run_phone_cleanup
from app.modules.phone.models import PhoneNoticeAcceptance, PhoneProof, PhoneSession
from app.modules.phone.views import admin_view
from app.modules.users.models import Role
from tests.clock_helpers import frozen_at, ist
from tests.face_helpers import set_privacy
from tests.people_helpers import PlantIds, client_for, create_plant, iso
from tests.phone_api_helpers import (
    ANDROID_CHROME,
    IPHONE_SAFARI,
    PHONE,
    SAMSUNG,
    People,
    give_password,
    make_people,
    phone_client,
    sign_in,
    switch_phone,
)
from tests.phone_helpers import make_phone_session

OUTSIDE = "/api/v1/employees/{}/phone/outside-work"


@pytest.fixture
def boss(db_app: FastAPI, db_session: Session) -> TestClient:
    set_privacy(db_session)
    return client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")


@pytest.fixture
def people(boss: TestClient, db_session: Session) -> People:
    plant: PlantIds = create_plant(boss, db_session, "DEMO1")
    found = make_people(boss, db_session, plant)
    switch_phone(boss, found.face_id)
    return found


# --- AC-49 (F-69): outside work until a date ----------------------------------------------------


def test_ac_49_outside_work_counts_until_the_end_of_the_until_day_then_the_job_ends_it(
    boss: TestClient, db_session: Session, people: People
) -> None:
    # The admin's own sign-in runs on the real clock, so the dates are relative to today.
    today = today_ist()
    past = boss.put(
        OUTSIDE.format(people.face_id),
        json={"allowed": True, "reason": "Customer site", "until": iso(today - timedelta(days=1))},
    )
    assert past.status_code == 422 and past.json()["error"]["code"] == "OUTSIDE_UNTIL_INVALID"
    until = today + timedelta(days=1)
    saved = boss.put(
        OUTSIDE.format(people.face_id),
        json={"allowed": True, "reason": "Customer site", "until": iso(until)},
    )
    assert saved.status_code == 200 and saved.json()["outside_work_until"] == iso(until)

    access = access_of(db_session, uuid.UUID(people.face_id))
    # The rule P2's punch uses: the IST date of the punch time against the until day
    # (spec: 03/11 23:50 IST still allowed, 04/11 00:10 IST not any more).
    assert outside_work_allowed_on(access, until) is True
    assert outside_work_allowed_on(access, until + timedelta(days=1)) is False

    employee = db_session.get(Employee, uuid.UUID(people.face_id))
    assert employee is not None
    with frozen_at(ist(until + timedelta(days=1), 0, 5)):
        view = admin_view(db_session, employee, show_ip=True)
        assert view.outside_work_allowed is True and view.outside_work_ended is True
        result = run_daily_jobs(db_session)
    assert result["outside_work_ended"] == 1
    db_session.expire_all()
    access = access_of(db_session, uuid.UUID(people.face_id))
    assert access is not None and not access.outside_work_allowed
    assert access.outside_work_until is None and access.phone_punch_enabled
    entry = db_session.scalars(
        select(AuditLog)
        .where(AuditLog.action == "phone_access.outside_off")
        .order_by(AuditLog.at.desc())
    ).first()
    assert entry is not None and entry.actor_type == "system"
    assert entry.reason == "Until date passed"
    assert run_daily_jobs(db_session)["outside_work_ended"] == 0  # safe to repeat


def test_outside_work_off_clears_the_date_and_a_repeat_changes_nothing(
    boss: TestClient, db_session: Session, people: People
) -> None:
    url = OUTSIDE.format(people.face_id)
    boss.put(url, json={"allowed": True, "reason": "Customer site"})
    boss.put(url, json={"allowed": True, "reason": "Customer site"})  # same: not audited
    off = boss.put(
        url, json={"allowed": False, "reason": "Back at the plant", "until": "2030-01-01"}
    )
    assert off.json()["outside_work_allowed"] is False and off.json()["outside_work_until"] is None
    actions = [
        row.action
        for row in db_session.scalars(
            select(AuditLog).where(AuditLog.action.like("phone_access.outside%"))
        )
    ]
    assert sorted(actions) == ["phone_access.outside_off", "phone_access.outside_on"]


# --- AC-50 (F-70): many phones ------------------------------------------------------------------


def test_ac_50_a_third_kind_of_phone_in_30_days_makes_one_notice_for_super_admins(
    boss: TestClient, db_app: FastAPI, db_session: Session, people: People
) -> None:
    give_password(db_session, people.face_id)
    for day, agent in (
        (date(2026, 10, 5), ANDROID_CHROME),
        (date(2026, 10, 20), SAMSUNG),
        (date(2026, 11, 2), IPHONE_SAFARI),
    ):
        with frozen_at(ist(day, 9, 0)):
            assert sign_in(phone_client(db_app, agent)).status_code == 200
    with frozen_at(ist(date(2026, 11, 3), 9, 0)):
        windows = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36"
        assert sign_in(phone_client(db_app, windows)).status_code == 200

    (notice,) = db_session.scalars(
        select(Notification).where(Notification.kind == "phone_many_phones")
    ).all()
    assert notice.params == {"count": 3} and notice.severity == "warning"
    assert notice.subject_ids == [uuid.UUID(people.face_id)]
    assert notice.target_user_id is None
    corporate = client_for(db_app, db_session, Role.CORPORATE_HEAD, "corp")
    kinds = [item["kind"] for item in corporate.get("/api/v1/notifications").json()["items"]]
    assert "phone_many_phones" not in kinds
    assert "phone_many_phones" in [
        item["kind"] for item in boss.get("/api/v1/notifications").json()["items"]
    ]


# --- AC-59 (S-49): at most 2 Argon2 checks at once ----------------------------------------------


def test_ac_59_eight_parallel_password_checks_run_at_most_two_at_a_time(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The sign-in's real and dummy checks go through the gate; 8 at once (a shift-change rush)
    never run more than 2 Argon2 checks together. Each check here is a real Argon2id check."""
    running = 0
    most_at_once = 0
    lock = threading.Lock()
    real_verify = sign_in_service.verify_password

    def counting_verify(password_hash: str, password: str) -> bool:
        nonlocal running, most_at_once
        with lock:
            running += 1
            most_at_once = max(most_at_once, running)
        try:
            time.sleep(0.05)  # keep the overlap window wide enough to notice a third check
            return real_verify(password_hash, password)
        finally:
            with lock:
                running -= 1

    monkeypatch.setattr(sign_in_service, "verify_password", counting_verify)
    stored = hash_password("Ganesh@2026")
    results: list[bool] = []

    def one_sign_in() -> None:
        results.append(sign_in_service.password_matches(stored, "Ganesh@2026"))

    threads = [threading.Thread(target=one_sign_in) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert results == [True] * 8
    assert most_at_once == 2


def test_ac_59_the_sign_in_uses_the_gate_for_real_and_dummy_checks(
    db_app: FastAPI, db_session: Session, people: People, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.core import password_gate

    held: list[int] = []
    real_verify = sign_in_service.verify_password
    real_dummy = sign_in_service.waste_time_like_a_password_check

    def watched_verify(password_hash: str, password: str) -> bool:
        held.append(password_gate._slots._value)  # noqa: SLF001 (free slots right now)
        return real_verify(password_hash, password)

    def watched_dummy(password: str) -> None:
        held.append(password_gate._slots._value)  # noqa: SLF001
        real_dummy(password)

    monkeypatch.setattr(sign_in_service, "verify_password", watched_verify)
    monkeypatch.setattr(sign_in_service, "waste_time_like_a_password_check", watched_dummy)
    give_password(db_session, people.face_id)
    phone = phone_client(db_app)
    sign_in(phone)
    sign_in(phone, code="NOBODY-1")
    assert held == [1, 1]  # one of the 2 slots was taken during each check


# --- The clean-up job ---------------------------------------------------------------------------


def test_cleanup_deletes_old_proofs_and_old_ended_sign_ins_but_keeps_the_notice_trail(
    db_app: FastAPI, db_session: Session, people: People
) -> None:
    give_password(db_session, people.face_id)
    phone = phone_client(db_app)
    sign_in(phone)
    shown = phone.get(f"{PHONE}/notice").json()
    phone.post(
        f"{PHONE}/notice/accept",
        json={"version": shown["version"], "text_sha256": shown["text_sha256"]},
    )
    now = utc_now()
    employee_id = uuid.UUID(people.face_id)
    long_ago = now - timedelta(days=200)
    old_plain = make_phone_session(db_session, employee_id, long_ago)
    old_plain.revoked_at = long_ago + timedelta(days=1)
    old_plain.revoke_kind = "logout"
    noticed = db_session.scalars(select(PhoneNoticeAcceptance)).one()
    kept_session = db_session.get(PhoneSession, noticed.session_id)
    assert kept_session is not None
    kept_session.created_at = long_ago
    kept_session.last_seen_at = long_ago
    kept_session.expires_at = long_ago + timedelta(days=30)
    kept_session.revoked_at = long_ago + timedelta(days=1)
    kept_session.revoke_kind = "logout"
    recent = make_phone_session(db_session, employee_id, now - timedelta(days=10))
    db_session.add_all(
        [
            PhoneProof(kind="card", issued_at=now - timedelta(days=2), expires_at=now),
            PhoneProof(kind="card", issued_at=now, expires_at=now + timedelta(minutes=5)),
        ]
    )
    db_session.commit()

    counts = run_phone_cleanup(db_session, now)

    assert counts == {
        "phone_proofs_deleted": 1,
        "phone_sessions_deleted": 1,
        "phone_sessions_scrubbed": 1,
    }
    # The kept sign-in (the notice trail) lost its IP, browser and agent; the recent one did not.
    db_session.expire_all()
    assert kept_session.ip is None and kept_session.user_agent is None
    assert kept_session.browser == "" and kept_session.system == ""
    assert recent.browser == "Chrome"
    assert run_phone_cleanup(db_session, now)["phone_sessions_scrubbed"] == 0  # safe to repeat
    remaining = set(db_session.scalars(select(PhoneSession.id)))
    assert old_plain.id not in remaining
    assert {kept_session.id, recent.id} <= remaining
    assert len(db_session.scalars(select(PhoneProof)).all()) >= 1
