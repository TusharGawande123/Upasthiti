"""M6 decision 0038 (1): a typed code of nobody is kept in the audit as HMAC + length."""

import json
import logging

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.audit.models import AuditLog
from app.modules.phone.typed_code_audit import (
    audit_fields_for_typed_code,
    typed_code_hmac,
    typed_code_key,
)

LOGIN = "/api/v1/phone/login"
NOT_A_CODE = "Hunter2-pw"  # a password typed into the code box by mistake


def test_a_code_of_nobody_is_kept_only_as_hash_and_length() -> None:
    fields = audit_fields_for_typed_code(" hunter2-pw ", employee_known=False)
    assert fields == {"code_hmac": typed_code_hmac("HUNTER2-PW"), "code_length": 10}
    assert "hunter" not in json.dumps(fields).lower()


def test_a_real_code_is_kept_as_typed_in_capitals() -> None:
    assert audit_fields_for_typed_code(" f-201 ", employee_known=True) == {"code": "F-201"}


def test_the_hash_is_keyed_and_stable() -> None:
    assert typed_code_hmac("abc") == typed_code_hmac(" ABC ")
    assert typed_code_hmac("abc") != typed_code_hmac("abd")
    assert len(typed_code_key()) == 32
    # Not the secret itself: the key is derived, so a leak of the log never gives the secret.
    assert typed_code_key() != b"test-secret-key-for-pytest-only-0123456789"[:32]


def test_unknown_code_at_phone_sign_in_leaves_no_typed_text_in_audit_or_logs(
    db_client: TestClient, db_session: Session, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)

    answer = db_client.post(LOGIN, json={"employee_code": NOT_A_CODE, "password": "x"})

    assert answer.status_code == 401
    row = db_session.scalars(
        select(AuditLog).where(AuditLog.action == "phone_auth.login_failed")
    ).one()
    assert row.after is not None
    assert row.after["code_length"] == len(NOT_A_CODE)
    assert row.after["code_hmac"] == typed_code_hmac(NOT_A_CODE)
    everything = json.dumps(row.after) + caplog.text
    assert NOT_A_CODE.lower() not in everything.lower()
