"""The data-request register (M6 spec 7.7, R-12; AC-M6-29, 30, 31, 32, 33). Real PostgreSQL, fake
data, the clock pinned."""

import uuid
from collections.abc import Iterator
from datetime import date, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.core.time import utc_now
from app.modules.audit.models import AuditLog
from app.modules.data_requests.models import DataRequest
from app.modules.notifications.alerts import run_morning_alerts
from app.modules.notifications.models import Notification
from app.modules.users.models import Role
from tests.clock_helpers import frozen_at, ist
from tests.people_helpers import client_for, create_plant, permanent_body

pytestmark = pytest.mark.time_sensitive

TODAY = date(2026, 11, 5)
URL = "/api/v1/data-requests"


@pytest.fixture(autouse=True)
def pinned_clock() -> Iterator[None]:
    with frozen_at(ist(TODAY, 10, 0)):
        yield


@pytest.fixture
def boss(db_app: FastAPI, db_session: Session) -> TestClient:
    return client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")


@pytest.fixture
def employee_id(boss: TestClient, db_session: Session) -> str:
    plant = create_plant(boss, db_session, "DEMO1")
    response = boss.post("/api/v1/employees", json=permanent_body(plant))
    assert response.status_code == 201, response.text
    return response.json()["id"]


def new_request(
    boss: TestClient, kind: str = "access", received_on: date = TODAY, **extra: object
) -> dict:
    body = {"kind": kind, "channel": "in_person", "received_on": received_on.isoformat(), **extra}
    response = boss.post(URL, json=body)
    assert response.status_code == 201, response.text
    return response.json()


def step(boss: TestClient, request_id: str, event_type: str, **extra: object):  # noqa: ANN201
    body = {"event_type": event_type, "detail": "ID card seen at the plant office", **extra}
    return boss.post(f"{URL}/{request_id}/events", json=body)


def error_code(response) -> str:  # noqa: ANN001
    return response.json()["error"]["code"]


def test_ac_m6_29_a_request_gets_a_due_day_30_days_later_and_an_audit_row(
    boss: TestClient, db_session: Session
) -> None:
    created = new_request(boss, note="Wants a copy of the data")

    assert created["due_on"] == "2026-12-05"
    assert created["status"] == "open"
    assert created["days_left"] == 30
    entries = db_session.scalars(
        select(AuditLog).where(AuditLog.action == "data_request.create").order_by(AuditLog.at)
    ).all()
    assert len(entries) == 1
    # The audit row holds the kind and the days, never the free-text note.
    assert "Wants a copy" not in str(entries[0].after)
    assert entries[0].after is not None and entries[0].after["kind"] == "access"


def test_ac_m6_29_the_due_day_follows_the_setting(boss: TestClient) -> None:
    assert (
        boss.put(
            "/api/v1/settings", json={"values": {"data_request_days": 14}, "reason": "test"}
        ).status_code
        == 200
    )

    assert new_request(boss)["due_on"] == "2026-11-19"


def test_ac_m6_29_a_stored_request_cannot_be_changed_or_deleted(
    boss: TestClient, db_session: Session
) -> None:
    created = new_request(boss)
    step(boss, created["id"], "identity_checked")
    request_id = uuid.UUID(created["id"])

    for statement in (
        "UPDATE data_requests SET note = 'x' WHERE id = :id",
        "DELETE FROM data_requests WHERE id = :id",
        "UPDATE data_request_events SET detail = 'x' WHERE data_request_id = :id",
        "DELETE FROM data_request_events WHERE data_request_id = :id",
    ):
        with pytest.raises(DBAPIError, match="append-only"), db_session.begin_nested():
            db_session.execute(text(statement), {"id": request_id})
    assert db_session.get(DataRequest, request_id) is not None


def test_received_on_in_the_future_is_refused(boss: TestClient) -> None:
    tomorrow = (TODAY + timedelta(days=1)).isoformat()
    response = boss.post(URL, json={"kind": "access", "channel": "email", "received_on": tomorrow})

    assert response.status_code == 422
    assert error_code(response) == "VALIDATION_FAILED"
    assert response.json()["error"]["details"]["field"] == "received_on"


def test_an_unknown_employee_is_refused_and_no_employee_is_allowed(boss: TestClient) -> None:
    unknown = boss.post(
        URL,
        json={
            "kind": "access",
            "channel": "letter",
            "received_on": TODAY.isoformat(),
            "employee_id": str(uuid.uuid4()),
        },
    )
    anonymous = new_request(boss, "complaint")

    assert (unknown.status_code, error_code(unknown)) == (404, "NOT_FOUND")
    assert anonymous["employee_code"] is None and anonymous["employee_id"] is None


def test_a_request_for_a_person_who_left_shows_the_employee_as_left(
    boss: TestClient, employee_id: str
) -> None:
    left = boss.post(
        f"/api/v1/employees/{employee_id}/mark-left",
        json={"left_on": "2026-11-01", "reason": "Quit"},
    )
    created = new_request(boss, "access", employee_id=employee_id)

    assert left.status_code == 200, left.text
    assert created["employee_code"] == "1043" and created["employee_left"] is True


def test_ac_m6_30_the_steps_run_in_order_and_action_taken_may_repeat(boss: TestClient) -> None:
    request_id = new_request(boss)["id"]

    for event_type in ("identity_checked", "action_taken", "action_taken", "answer_sent"):
        assert step(boss, request_id, event_type).status_code == 201
    closed = step(boss, request_id, "closed", outcome="done")

    assert closed.status_code == 201
    detail = boss.get(f"{URL}/{request_id}").json()
    assert [event["event_type"] for event in detail["events"]] == [
        "identity_checked",
        "action_taken",
        "action_taken",
        "answer_sent",
        "closed",
    ]
    assert (detail["status"], detail["outcome"], detail["days_left"]) == ("closed", "done", None)


@pytest.mark.parametrize(
    ("steps_before", "wrong_step"),
    [
        ([], "action_taken"),
        ([], "answer_sent"),
        ([], "closed"),
        (["identity_checked"], "identity_checked"),
        (["identity_checked"], "answer_sent"),
        (["identity_checked", "action_taken"], "closed"),
        (["identity_checked", "action_taken", "answer_sent"], "action_taken"),
    ],
)
def test_ac_m6_30_a_step_out_of_order_is_refused(
    boss: TestClient, steps_before: list[str], wrong_step: str
) -> None:
    request_id = new_request(boss)["id"]
    for event_type in steps_before:
        assert step(boss, request_id, event_type).status_code == 201

    response = step(
        boss, request_id, wrong_step, outcome="done" if wrong_step == "closed" else None
    )

    assert (response.status_code, error_code(response)) == (409, "DATA_REQUEST_STEP_INVALID")


def test_ac_m6_30_a_closed_request_takes_no_more_steps(boss: TestClient) -> None:
    request_id = new_request(boss)["id"]
    for event_type in ("identity_checked", "action_taken", "answer_sent"):
        step(boss, request_id, event_type)
    step(boss, request_id, "closed", outcome="done")

    response = step(boss, request_id, "action_taken")

    assert (response.status_code, error_code(response)) == (409, "DATA_REQUEST_CLOSED")


def test_an_unknown_request_is_not_found(boss: TestClient) -> None:
    missing = str(uuid.uuid4())

    for response in (boss.get(f"{URL}/{missing}"), step(boss, missing, "identity_checked")):
        assert (response.status_code, error_code(response)) == (404, "DATA_REQUEST_NOT_FOUND")


def go_to_answered(boss: TestClient, request_id: str) -> None:
    for event_type in ("identity_checked", "action_taken", "answer_sent"):
        assert step(boss, request_id, event_type).status_code == 201


def test_closing_needs_an_outcome_and_only_closing_has_one(boss: TestClient) -> None:
    request_id = new_request(boss)["id"]

    early = step(boss, request_id, "identity_checked", outcome="done")
    go_to_answered(boss, request_id)
    no_outcome = step(boss, request_id, "closed")

    for response in (early, no_outcome):
        assert response.status_code == 422
        assert response.json()["error"]["details"]["field"] == "outcome"


@pytest.mark.parametrize("outcome", ["partly_done", "refused"])
def test_partly_done_and_refused_need_a_reason_of_ten_characters(
    boss: TestClient, outcome: str
) -> None:
    request_id = new_request(boss)["id"]
    go_to_answered(boss, request_id)

    short = step(boss, request_id, "closed", outcome=outcome, detail="too short")
    long_enough = step(
        boss, request_id, "closed", outcome=outcome, detail="Records are kept by law."
    )

    assert short.status_code == 422 and short.json()["error"]["details"]["field"] == "detail"
    assert long_enough.status_code == 201


def test_ac_m6_31_an_erasure_with_kept_records_closes_only_as_partly_done(
    boss: TestClient, employee_id: str
) -> None:
    # The employee has audit rows (created by the API), so records are kept.
    request_id = new_request(boss, "erasure", employee_id=employee_id)["id"]
    go_to_answered(boss, request_id)
    reason = "Attendance and audit records are kept as the Labour Codes require."

    for outcome in ("done", "refused"):
        refused = step(boss, request_id, "closed", outcome=outcome, detail=reason)
        assert refused.status_code == 422
        assert refused.json()["error"]["details"]["field"] == "outcome"
    accepted = step(boss, request_id, "closed", outcome="partly_done", detail=reason)

    assert accepted.status_code == 201
    assert boss.get(f"{URL}/{request_id}").json()["outcome"] == "partly_done"


def test_an_erasure_for_a_person_who_is_not_an_employee_may_close_as_done(
    boss: TestClient,
) -> None:
    request_id = new_request(boss, "erasure")["id"]
    go_to_answered(boss, request_id)

    assert step(boss, request_id, "closed", outcome="done").status_code == 201


def test_an_event_links_an_existing_audit_entry_only(boss: TestClient, db_session: Session) -> None:
    request_id = new_request(boss)["id"]
    step(boss, request_id, "identity_checked")
    entry = db_session.scalars(select(AuditLog).order_by(AuditLog.at.desc(), AuditLog.id)).first()
    assert entry is not None

    linked = step(boss, request_id, "action_taken", audit_entry_id=str(entry.id))
    missing = step(boss, request_id, "action_taken", audit_entry_id=str(uuid.uuid4()))

    assert linked.status_code == 201 and linked.json()["audit_entry_id"] == str(entry.id)
    assert missing.status_code == 422
    assert missing.json()["error"]["details"]["field"] == "audit_entry_id"


def test_the_audit_row_of_a_step_holds_the_step_and_never_the_detail(
    boss: TestClient, db_session: Session
) -> None:
    request_id = new_request(boss)["id"]
    step(boss, request_id, "identity_checked", detail="Secret words about the person")

    entries = db_session.scalars(
        select(AuditLog).where(AuditLog.action == "data_request.event").order_by(AuditLog.at)
    ).all()
    assert len(entries) == 1
    assert entries[0].after == {
        "kind": "access",
        "event_type": "identity_checked",
        "outcome": None,
    }


def test_the_list_filters_by_status_kind_overdue_and_due_soon(boss: TestClient) -> None:
    fresh = new_request(boss, "access")["id"]
    old = new_request(boss, "correction", received_on=TODAY - timedelta(days=40))["id"]
    soon = new_request(boss, "complaint", received_on=TODAY - timedelta(days=27))["id"]
    started = new_request(boss, "other")["id"]
    step(boss, started, "identity_checked")
    # An overdue request that is closed is not overdue any more.
    old_days = timedelta(days=50)
    finished = new_request(boss, "other", received_on=TODAY - old_days)["id"]
    go_to_answered(boss, finished)
    step(boss, finished, "closed", outcome="done")

    def ids(query: str) -> list[str]:
        response = boss.get(f"{URL}?{query}")
        assert response.status_code == 200, response.text
        return [item["id"] for item in response.json()["items"]]

    assert ids("overdue=true") == [old]
    assert ids("due_soon=true") == [old, soon]
    assert ids("status=open") == [old, soon, fresh]
    assert ids("status=identity_checked") == [started]
    assert ids("status=closed") == [finished]
    assert ids("kind=complaint") == [soon]
    assert set(ids("overdue=false")) == {soon, started, fresh, finished}
    # Open requests come first, the most urgent on top; the closed one is last.
    everything = ids("")
    assert everything[:2] == [old, soon] and everything[-1] == finished
    assert set(everything) == {old, soon, fresh, started, finished}
    overdue_item = boss.get(f"{URL}?overdue=true").json()["items"][0]
    assert overdue_item["days_left"] == -10


def test_ac_m6_33_corporate_and_plant_heads_get_forbidden(
    db_app: FastAPI, db_session: Session, boss: TestClient
) -> None:
    request_id = new_request(boss)["id"]
    heads = [
        client_for(db_app, db_session, Role.CORPORATE_HEAD, "corp"),
        client_for(db_app, db_session, Role.PLANT_HEAD, "head"),
    ]
    body = {"kind": "access", "channel": "email", "received_on": TODAY.isoformat()}

    for head in heads:
        responses = [
            head.get(URL),
            head.post(URL, json=body),
            head.get(f"{URL}/{request_id}"),
            step(head, request_id, "identity_checked"),
        ]
        for response in responses:
            assert (response.status_code, error_code(response)) == (403, "FORBIDDEN")


def test_ac_m6_33_a_request_without_login_is_refused(db_client: TestClient) -> None:
    assert db_client.get(URL).status_code == 401


# --- The 07:00 notice (AC-M6-32) -------------------------------------------------------------


def due_notices(session: Session) -> list[Notification]:
    return list(
        session.scalars(
            select(Notification)
            .where(Notification.kind == "data_request_due")
            .order_by(Notification.created_at, Notification.id)
        )
    )


def test_ac_m6_32_a_notice_five_days_before_and_on_the_due_day_but_only_once(
    boss: TestClient, db_session: Session
) -> None:
    due_in_five = new_request(boss, received_on=TODAY - timedelta(days=25))["id"]
    due_in_six = new_request(boss, received_on=TODAY - timedelta(days=24))["id"]

    run_morning_alerts(db_session, utc_now())
    run_morning_alerts(db_session, utc_now())

    notices = due_notices(db_session)
    assert len(notices) == 1
    notice = notices[0]
    assert notice.target_user_id is None and notice.plant_id is None
    assert notice.text_key == "notification.data_request_due"
    assert notice.params == {"due_on": "2026-11-10", "days": 5}
    assert str(notice.subject_ids[0]) != due_in_six
    assert str(notice.subject_ids[0]) == due_in_five
    assert "Ravi" not in str(notice.params)

    with frozen_at(ist(TODAY + timedelta(days=5), 7, 0)):
        run_morning_alerts(db_session, utc_now())
        run_morning_alerts(db_session, utc_now())

    assert [n.params["days"] for n in due_notices(db_session)] == [5, 0]


def test_ac_m6_32_a_closed_request_makes_no_notice(boss: TestClient, db_session: Session) -> None:
    request_id = new_request(boss, received_on=TODAY - timedelta(days=28))["id"]
    go_to_answered(boss, request_id)
    step(boss, request_id, "closed", outcome="done")

    run_morning_alerts(db_session, utc_now())

    assert due_notices(db_session) == []


def test_ac_m6_32_only_the_super_admin_sees_the_notice(
    db_app: FastAPI, db_session: Session, boss: TestClient
) -> None:
    new_request(boss, received_on=TODAY - timedelta(days=25))
    run_morning_alerts(db_session, utc_now())
    head = client_for(db_app, db_session, Role.CORPORATE_HEAD, "corp")

    def kinds(client: TestClient) -> list[str]:
        return [item["text_key"] for item in client.get("/api/v1/notifications").json()["items"]]

    assert "notification.data_request_due" in kinds(boss)
    assert "notification.data_request_due" not in kinds(head)
