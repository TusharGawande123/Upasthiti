"""M6 AC-M6-11: every write route refuses a foreign or missing Origin, for admin and phone alike.

The server cannot tell a real browser from a script, but a browser always adds the Origin
header to a cross-site write and a web page cannot fake it. So every write route must answer
403 ORIGIN_NOT_ALLOWED when the Origin is another site, or is missing and no own-site Referer is
there. The routes come from the role matrix table, which another test keeps equal to the app.
"""

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.modules.users.models import Role
from tests.conftest import TEST_ORIGIN
from tests.face_helpers import set_privacy
from tests.people_helpers import client_for, create_plant
from tests.phone_api_helpers import give_password, make_people, phone_client, sign_in, switch_phone
from tests.role_matrix import ROUTE_AUDIENCE
from tests.test_m6_role_matrix import concrete_path

WRITE_METHODS = ("POST", "PUT", "PATCH", "DELETE")
FOREIGN_ORIGIN = "https://evil.example"


def write_routes() -> list[tuple[str, str]]:
    return sorted(key for key in ROUTE_AUDIENCE if key[0] in WRITE_METHODS)


def refused_routes(client: TestClient, headers: dict[str, str]) -> list[tuple[str, str, int]]:
    """The write routes that did NOT answer 403 ORIGIN_NOT_ALLOWED."""
    wrong = []
    for method, path_format in write_routes():
        answer = client.request(method, concrete_path(path_format), json={}, headers=headers)
        code = answer.json().get("error", {}).get("code") if answer.status_code == 403 else None
        if code != "ORIGIN_NOT_ALLOWED":
            wrong.append((method, path_format, answer.status_code))
    return wrong


def test_there_are_many_write_routes_to_check() -> None:
    assert len(write_routes()) > 80


def test_admin_writes_from_another_site_are_refused(db_app: FastAPI, db_session: Session) -> None:
    """M6 AC-M6-11: a signed-in Super Admin's browser, tricked by another site."""
    boss = client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")
    cookie_only = TestClient(db_app, raise_server_exceptions=False, cookies=boss.cookies)

    assert refused_routes(cookie_only, {"Origin": FOREIGN_ORIGIN}) == []
    assert refused_routes(cookie_only, {}) == []
    assert refused_routes(cookie_only, {"Referer": f"{FOREIGN_ORIGIN}/page"}) == []
    # A look-alike address that only starts with ours is another site too.
    assert refused_routes(cookie_only, {"Origin": TEST_ORIGIN + ".evil.example"}) == []


def test_anonymous_writes_from_another_site_are_refused(db_app: FastAPI) -> None:
    """M6 AC-M6-11: the origin check comes before login, pairing and the phone sign-in."""
    nobody = TestClient(db_app, raise_server_exceptions=False)

    assert refused_routes(nobody, {"Origin": FOREIGN_ORIGIN}) == []
    assert refused_routes(nobody, {}) == []


def test_phone_writes_from_another_site_are_refused(db_app: FastAPI, db_session: Session) -> None:
    """M6 AC-M6-11: a signed-in phone employee's browser, tricked by another site."""
    boss = client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")
    plant = create_plant(boss, db_session, "K134")
    set_privacy(db_session)
    people = make_people(boss, db_session, plant)
    assert switch_phone(boss, people.face_id).status_code == 200
    give_password(db_session, people.face_id)
    phone = phone_client(db_app)
    assert sign_in(phone).status_code == 200
    token = phone.cookies.get("ups_phone")
    assert token
    cookie_only = TestClient(db_app, raise_server_exceptions=False, cookies={"ups_phone": token})

    assert refused_routes(cookie_only, {"Origin": FOREIGN_ORIGIN}) == []
    assert refused_routes(cookie_only, {}) == []
    # The own-site Origin still works, so the check is not simply refusing everything.
    own = cookie_only.get("/api/v1/phone/me", headers={"Origin": TEST_ORIGIN})
    assert own.status_code == 200
