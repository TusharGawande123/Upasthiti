"""The notification centre (M5 spec §5.7, §7 rule 20; F-7; AC-32, AC-33, AC-34).
Real PostgreSQL, fake data, the clock pinned. Email goes through a fake sender: no real mail."""

import uuid
from collections.abc import Iterator
from datetime import date

import pytest
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import utc_now
from app.modules.notifications import email_sender
from app.modules.notifications.models import Notification, NotificationDelivery
from app.modules.notifications.service import (
    create_notification,
    resolve_notification,
    update_open_notification,
)
from app.modules.users.models import Role, User
from app.modules.users.plant_access import set_user_plant
from tests.clock_helpers import frozen_at, ist
from tests.conftest import clear_cached_settings
from tests.people_helpers import PlantIds, client_for, create_plant

NOON = ist(date(2026, 10, 29), 12, 0)
URL = "/api/v1/notifications"


@pytest.fixture(autouse=True)
def pinned_clock() -> Iterator[None]:
    with frozen_at(NOON):
        yield


@pytest.fixture
def world(db_app: FastAPI, db_session: Session) -> dict:
    boss = client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")
    own = create_plant(boss, db_session, "DEMO1")
    other = create_plant(boss, db_session, "DEMO2")
    head = client_for(db_app, db_session, Role.PLANT_HEAD, "head")
    user = db_session.scalars(select(User).where(User.username == "head")).one()
    set_user_plant(db_session, user, uuid.UUID(own.id))
    db_session.commit()
    return {
        "boss": boss,
        "head": head,
        "corporate": client_for(db_app, db_session, Role.CORPORATE_HEAD, "corp"),
        "own": own,
        "other": other,
        "session": db_session,
    }


def make(world: dict, kind: str, plant: PlantIds | None, key: str, **extra: object):
    notification = create_notification(
        world["session"],
        kind=kind,
        severity=str(extra.pop("severity", "warning")),
        plant_id=uuid.UUID(plant.id) if plant else None,
        text_key=f"notification.{kind}",
        params={"count": 2, "plant": plant.code if plant else ""},
        link="/admin/muster",
        dedupe_key=key,
        **extra,  # type: ignore[arg-type]
    )
    world["session"].commit()
    return notification


def test_one_notification_per_dedupe_key_and_an_open_count_is_updated(world: dict) -> None:
    first = make(world, "still_inside", world["own"], "still:DEMO1:2026-10-29")
    again = make(world, "still_inside", world["own"], "still:DEMO1:2026-10-29")
    update_open_notification(
        world["session"], "still:DEMO1:2026-10-29", params={"count": 3}, subject_ids=[]
    )
    world["session"].commit()

    assert first is not None and again is None
    rows = world["session"].scalars(select(Notification)).all()
    assert len(rows) == 1 and rows[0].params == {"count": 3}
    resolve_notification(world["session"], "still:DEMO1:2026-10-29", utc_now())
    assert rows[0].resolved_at is not None


def test_what_each_role_sees(world: dict) -> None:
    make(world, "still_inside", world["own"], "a")
    make(world, "still_inside", world["other"], "b")
    make(world, "review_digest", None, "c", severity="info")
    make(world, "correction_requested", world["own"], "d", severity="info")

    def kinds(who: str) -> list[tuple[str, str | None]]:
        body = world[who].get(URL).json()
        return sorted((item["kind"], (item["plant"] or {}).get("code")) for item in body["items"])

    assert len(kinds("boss")) == 4
    # A Corporate Head reads the alerts of every plant, never the digest or the requests.
    assert kinds("corporate") == [("still_inside", "DEMO1"), ("still_inside", "DEMO2")]
    # A Plant Head reads only the own plant's.
    assert kinds("head") == [("still_inside", "DEMO1")]


def test_unread_count_read_one_read_all_and_not_found(world: dict) -> None:
    ids = [make(world, "still_inside", world["own"], f"k{n}").id for n in range(3)]  # type: ignore[union-attr]
    elsewhere = make(world, "still_inside", world["other"], "z")
    assert elsewhere is not None

    assert world["head"].get(f"{URL}/unread-count").json() == {"unread": 3}
    assert world["head"].post(f"{URL}/{ids[0]}/read").status_code == 204
    assert world["head"].post(f"{URL}/{ids[0]}/read").status_code == 204  # safe to repeat
    assert world["head"].get(f"{URL}/unread-count").json() == {"unread": 2}
    unread_only = world["head"].get(URL, params={"unread": "true"}).json()
    assert unread_only["total"] == 2
    # Somebody else's alert looks like it does not exist.
    refused = world["head"].post(f"{URL}/{elsewhere.id}/read")
    assert refused.status_code == 404 and refused.json()["error"]["code"] == "NOT_FOUND"
    assert world["head"].post(f"{URL}/read-all").status_code == 204
    assert world["head"].get(f"{URL}/unread-count").json() == {"unread": 0}
    # The Super Admin's own marks are separate.
    assert world["boss"].get(f"{URL}/unread-count").json()["unread"] == 4


def test_a_correction_request_and_its_decision_make_notifications(world: dict) -> None:
    """AC-17 / spec rule 12: the Super Admin hears of a request, the requester of the decision,
    with the reason when it was rejected."""
    boss, head, session = world["boss"], world["head"], world["session"]
    shift = boss.post(
        f"/api/v1/plants/{world['own'].id}/shifts",
        json={"name": "Office", "start_time": "09:00", "end_time": "17:00"},
    ).json()
    boss.patch(f"/api/v1/plants/{world['own'].id}", json={"attendance_start_date": "2026-10-01"})
    from tests.people_helpers import permanent_body

    employee = boss.post(
        "/api/v1/employees",
        json=permanent_body(world["own"], code="E-1") | {"shift_id": shift["id"]},
    ).json()
    asked = head.post(
        "/api/v1/regularisations",
        json={
            "employee_id": employee["id"],
            "attendance_date": "2026-10-28",
            "kind": "add_in_out",
            "in_time": ist(date(2026, 10, 28), 9, 0).isoformat(),
            "out_time": ist(date(2026, 10, 28), 17, 0).isoformat(),
            "reason": "Gate device was down",
        },
    ).json()["correction"]

    boss_sees = [i["kind"] for i in boss.get(URL).json()["items"]]
    assert boss_sees == ["correction_requested"]
    assert head.get(URL).json()["total"] == 0  # a head does not see requests

    boss.post(f"/api/v1/regularisations/{asked['id']}/reject", json={"reason": "No proof"})

    mine = head.get(URL).json()["items"]
    assert [i["kind"] for i in mine] == ["correction_decided"]
    assert mine[0]["params"]["result"] == "rejected" and mine[0]["params"]["reason"] == "No proof"
    assert len(session.scalars(select(Notification)).all()) == 2


def test_preferences_need_an_email_address_and_a_known_kind(world: dict) -> None:
    head = world["head"]

    no_address = head.put(
        "/api/v1/me/notification-preferences",
        json={"email_enabled": True, "email_kinds": ["still_inside"]},
    )
    shown = head.get("/api/v1/me/notification-preferences").json()

    assert no_address.status_code == 409
    assert no_address.json()["error"]["code"] == "EMAIL_ADDRESS_MISSING"
    assert shown == {
        "email_enabled": False,
        "email_kinds": [],
        "email_configured": False,
        "has_email": False,
    }


def test_email_is_silently_off_without_smtp(world: dict) -> None:
    """AC-33: nothing is queued and nothing fails when the server has no SMTP settings."""
    user = world["session"].scalars(select(User).where(User.username == "boss")).one()
    user.email = "boss@example.com"
    user.email_alerts_enabled = True
    user.email_alert_kinds = ["still_inside"]
    world["session"].commit()

    make(world, "still_inside", world["own"], "quiet")

    assert world["session"].scalars(select(NotificationDelivery)).all() == []
    test = world["boss"].post(f"{URL}/test-email")
    assert test.status_code == 409 and test.json()["error"]["code"] == "EMAIL_NOT_CONFIGURED"


@pytest.fixture
def smtp(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, str, str]]:
    """The server has SMTP settings; the sender is a fake that records what would be sent."""
    monkeypatch.setenv("SMTP_HOST", "mail.example.test")
    monkeypatch.setenv("SMTP_FROM", "alerts@example.test")
    clear_cached_settings()
    sent: list[tuple[str, str, str]] = []
    monkeypatch.setattr(
        email_sender, "send_email", lambda to, subject, body: sent.append((to, subject, body))
    )
    return sent


def test_email_goes_once_per_person_with_no_names_when_smtp_is_set(
    world: dict, smtp: list[tuple[str, str, str]]
) -> None:
    boss, session = world["boss"], world["session"]
    user = session.scalars(select(User).where(User.username == "boss")).one()
    user.email = "boss@example.com"
    session.commit()
    saved = boss.put(
        "/api/v1/me/notification-preferences",
        json={"email_enabled": True, "email_kinds": ["still_inside"]},
    )
    assert saved.status_code == 200 and saved.json()["email_configured"] is True
    off = make(world, "still_inside", world["own"], "off-1")
    assert off is not None and smtp == []  # the setting email_alerts is still off

    boss.put("/api/v1/settings", json={"values": {"email_alerts": "on"}, "reason": "Own server"})
    make(world, "still_inside", world["own"], "on-1")
    make(world, "still_inside", world["own"], "on-1")  # a repeat: no second email
    make(world, "review_digest", None, "digest", severity="info")  # a kind not switched on

    assert len(smtp) == 1
    to, _subject, body = smtp[0]
    assert to == "boss@example.com"
    assert "2 people are still inside DEMO1" in body
    deliveries = session.scalars(select(NotificationDelivery)).all()
    assert [(d.state, d.channel) for d in deliveries] == [("sent", "email")]


def test_a_failed_email_is_recorded_without_the_address(
    world: dict, smtp: list[tuple[str, str, str]], monkeypatch: pytest.MonkeyPatch
) -> None:
    boss, session = world["boss"], world["session"]
    user = session.scalars(select(User).where(User.username == "boss")).one()
    user.email = "boss@example.com"
    session.commit()
    boss.put(
        "/api/v1/me/notification-preferences",
        json={"email_enabled": True, "email_kinds": ["still_inside"]},
    )
    boss.put("/api/v1/settings", json={"values": {"email_alerts": "on"}, "reason": "Own server"})

    def refuse(*_args: object) -> None:
        raise OSError("connection refused for boss@example.com")

    monkeypatch.setattr(email_sender, "send_email", refuse)
    make(world, "still_inside", world["own"], "fails")

    (delivery,) = session.scalars(select(NotificationDelivery)).all()
    assert delivery.state == "failed" and delivery.error_code == "OSError"
    assert "@" not in (delivery.error_code or "")
    sent = boss.post(f"{URL}/test-email")
    assert sent.status_code == 502 and sent.json()["error"]["code"] == "EMAIL_SEND_FAILED"
