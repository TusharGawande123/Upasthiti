"""M6 AC-M6-13 and AC-M6-14: the client IP per hosting layout; limits a fake header cannot beat."""

import re
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.client_ip import pick_client_ip
from app.modules.audit.models import AuditLog
from tests.conftest import TEST_ORIGIN, clear_cached_settings
from tests.kiosk_helpers import Device

APP_FOLDER = Path(__file__).resolve().parent.parent / "app"
REAL_CALLER = "203.0.113.7"
FORGED = "6.6.6.6"
LOGIN = "/api/v1/auth/login"
REGISTER = "/api/v1/kiosk/register"


# --- Pure rule: each hosting layout, with and without a caller who forges entries ---------


@pytest.mark.parametrize(
    ("layout", "hops", "forwarded_for", "socket_ip"),
    [
        # Vercel + Render today: four addresses are added after the caller's own.
        ("vercel and render", 4, f"{REAL_CALLER}, 10.1.1.1, 10.1.1.2, 10.1.1.3", "10.1.1.4"),
        ("one proxy", 1, REAL_CALLER, "10.0.0.2"),
        ("two proxies", 2, f"{REAL_CALLER}, 10.0.0.3", "10.0.0.2"),
    ],
)
def test_the_real_address_wins_even_when_the_caller_adds_entries(
    layout: str, hops: int, forwarded_for: str, socket_ip: str
) -> None:
    """AC-M6-13: forged entries sit LEFT of the real one, so they are never picked."""
    assert pick_client_ip(forwarded_for, socket_ip, hops) == REAL_CALLER, layout
    forged_chain = f"{FORGED}, 8.8.8.8, {forwarded_for}"
    assert pick_client_ip(forged_chain, socket_ip, hops) == REAL_CALLER, layout


def test_no_proxy_means_the_header_is_ignored() -> None:
    assert pick_client_ip(FORGED, REAL_CALLER, 0) == REAL_CALLER


def test_a_header_shorter_than_the_proxy_count_uses_the_connection_address() -> None:
    """The flaw of M5: with hops >= entries the caller-written first entry used to win."""
    assert pick_client_ip(FORGED, "10.0.0.9", 4) == "10.0.0.9"
    assert pick_client_ip(f"{FORGED}, 7.7.7.7", "10.0.0.9", 3) == "10.0.0.9"


def test_single_value_header_is_used_as_it_is() -> None:
    assert pick_client_ip(None, "10.0.0.9", 0, REAL_CALLER, True) == REAL_CALLER
    # The forwarding header is ignored in this mode.
    assert pick_client_ip(FORGED, "10.0.0.9", 4, REAL_CALLER, True) == REAL_CALLER


@pytest.mark.parametrize("value", [None, "", "not-an-ip", f"{FORGED}, {REAL_CALLER}", "1.2.3"])
def test_single_value_header_that_does_not_fit_falls_back_to_the_connection(
    value: str | None,
) -> None:
    assert pick_client_ip(FORGED, "10.0.0.9", 0, value, True) == "10.0.0.9"


def test_ipv6_is_written_in_one_form() -> None:
    assert pick_client_ip(None, "10.0.0.9", 0, "2001:0db8:0:0:0:0:0:1", True) == "2001:db8::1"


def test_the_connection_address_is_not_an_ip() -> None:
    assert pick_client_ip(None, "testclient", 0) == "unknown"


# --- Only client_ip.py may read the connection address or a forwarding header ------------


def test_nothing_else_reads_the_connection_address_or_forwarding_headers() -> None:
    pattern = re.compile(r"request\.client\.host|x-forwarded-for|x-real-ip|forwarded-for", re.I)
    offenders = []
    for path in sorted(APP_FOLDER.rglob("*.py")):
        if path.name == "client_ip.py":
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if pattern.search(line):
                offenders.append(f"{path.relative_to(APP_FOLDER)}:{number}")
    assert offenders == []


# --- Through the real app: audit IP and limits --------------------------------------------


def client_from(app: FastAPI, address: str) -> TestClient:
    """A test client whose connection address is `address`."""
    return TestClient(
        app,
        raise_server_exceptions=False,
        headers={"Origin": TEST_ORIGIN},
        client=(address, 50000),
    )


def use_settings(monkeypatch: pytest.MonkeyPatch, **values: str) -> None:
    for name, value in values.items():
        monkeypatch.setenv(name, value)
    clear_cached_settings()


def failed_login(client: TestClient, headers: dict[str, str] | None = None):
    return client.post(LOGIN, json={"login": "nobody", "password": "x"}, headers=headers or {})


def test_audit_log_holds_the_real_address_behind_two_proxies(
    db_app: FastAPI, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    use_settings(monkeypatch, TRUSTED_PROXY_HOPS="2")
    client = client_from(db_app, "10.0.0.2")

    failed_login(client, {"X-Forwarded-For": f"{FORGED}, {REAL_CALLER}, 10.0.0.3"})

    row = db_session.scalars(select(AuditLog).order_by(AuditLog.id.desc())).first()
    assert row is not None and str(row.ip) == REAL_CALLER


def test_audit_log_holds_the_value_of_the_single_value_header(
    db_app: FastAPI, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    use_settings(monkeypatch, CLIENT_IP_HEADER="X-Vercel-Test-Ip", TRUSTED_PROXY_HOPS="4")
    client = client_from(db_app, "10.0.0.2")

    failed_login(client, {"X-Vercel-Test-Ip": REAL_CALLER, "X-Forwarded-For": FORGED})

    row = db_session.scalars(select(AuditLog).order_by(AuditLog.id.desc())).first()
    assert row is not None and str(row.ip) == REAL_CALLER


def test_login_limit_cannot_be_beaten_by_changing_the_header_with_no_proxy(
    db_app: FastAPI,
) -> None:
    """AC-M6-14: 20 logins per 10 minutes, the 21st is refused whatever header is sent."""
    client = client_from(db_app, REAL_CALLER)
    answers = [
        failed_login(client, {"X-Forwarded-For": f"10.9.0.{number}"}).status_code
        for number in range(21)
    ]
    assert answers[:20] == [401] * 20
    assert answers[20] == 429


def test_login_limit_holds_when_the_caller_adds_a_new_left_entry_each_time(
    db_app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    use_settings(monkeypatch, TRUSTED_PROXY_HOPS="2")
    client = client_from(db_app, "10.0.0.2")
    answers = [
        failed_login(
            client, {"X-Forwarded-For": f"10.9.0.{number}, {REAL_CALLER}, 10.0.0.3"}
        ).status_code
        for number in range(21)
    ]
    assert answers[20] == 429


def test_login_limit_holds_with_the_single_value_header_missing_or_faked(
    db_app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    use_settings(monkeypatch, CLIENT_IP_HEADER="X-Vercel-Test-Ip")
    client = client_from(db_app, REAL_CALLER)
    answers = []
    for number in range(21):
        # A comma-separated fake does not fit, so every request counts against the connection.
        answers.append(
            failed_login(client, {"X-Vercel-Test-Ip": f"10.9.0.{number}, 1.1.1.1"}).status_code
        )
    assert answers[20] == 429


def test_pairing_limit_cannot_be_beaten_by_a_fake_header(db_app: FastAPI) -> None:
    """AC-M6-14: 10 pairing attempts per 10 minutes per address."""
    client = client_from(db_app, REAL_CALLER)
    body = {"pairing_code": "000000", "public_key_spki": Device().public_key, "location": None}
    answers = [
        client.post(REGISTER, json=body, headers={"X-Forwarded-For": f"10.9.0.{number}"})
        for number in range(11)
    ]
    assert answers[10].status_code == 429
    assert answers[10].json()["error"]["code"] == "TOO_MANY_REQUESTS"
    assert all(answer.status_code != 429 for answer in answers[:10])
