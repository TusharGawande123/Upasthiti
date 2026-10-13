"""Audit entries keep only changes, hide secrets, and can never be changed (spec AC-24, AC-25)."""

import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.modules.audit.models import AuditLog
from app.modules.audit.service import (
    HIDDEN,
    SYSTEM_ACTOR,
    Actor,
    changed_fields,
    hide_secrets,
    record_audit,
    to_json_safe,
)


def test_only_changed_fields_are_kept() -> None:
    before, after = changed_fields(
        {"name": "Ravi", "shift": "General"}, {"name": "Ravi", "shift": "Night"}
    )

    assert before == {"shift": "General"}
    assert after == {"shift": "Night"}


def test_create_and_delete_keep_all_fields() -> None:
    assert changed_fields(None, {"name": "Ravi"}) == (None, {"name": "Ravi"})


def test_secret_fields_are_hidden() -> None:
    hidden = hide_secrets({"password_hash": "argon2...", "token": "abc", "name": "Ravi"})

    assert hidden == {"password_hash": HIDDEN, "token": HIDDEN, "name": "Ravi"}


def test_values_become_plain_json() -> None:
    some_id = uuid.uuid4()

    safe = to_json_safe({"id": some_id, "rate": Decimal("150.00"), "joined": date(2026, 10, 13)})

    assert safe == {"id": str(some_id), "rate": "150.00", "joined": "2026-10-13"}


def test_record_audit_writes_a_row(db_session: Session) -> None:
    actor = Actor(actor_type="user", actor_id=uuid.uuid4(), ip="203.0.113.7")

    record_audit(
        db_session,
        actor=actor,
        action="settings.update",
        entity_type="setting",
        before={"value": 50},
        after={"value": 30},
        reason="Gate phones are accurate",
    )
    db_session.commit()

    row = db_session.scalars(select(AuditLog)).one()
    assert row.action == "settings.update"
    assert row.before == {"value": 50}
    assert row.after == {"value": 30}
    assert str(row.ip) == "203.0.113.7"


def test_unknown_ip_is_stored_as_empty(db_session: Session) -> None:
    record_audit(
        db_session,
        actor=Actor(actor_type="user", actor_id=None, ip="unknown"),
        action="auth.login",
        entity_type="user",
    )
    db_session.commit()

    assert db_session.scalars(select(AuditLog)).one().ip is None


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE audit_logs SET action = 'changed'",
        "DELETE FROM audit_logs",
        "TRUNCATE audit_logs",
    ],
)
def test_database_refuses_to_change_audit_rows(db_session: Session, statement: str) -> None:
    record_audit(db_session, actor=SYSTEM_ACTOR, action="test.entry", entity_type="test")
    db_session.commit()

    with pytest.raises(DBAPIError, match="append-only"):
        db_session.execute(text(statement))
