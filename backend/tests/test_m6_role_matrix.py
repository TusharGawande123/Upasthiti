"""M6 AC-M6-9: every route against the six callers, and a route without a table row fails."""

import json
import uuid
from collections.abc import Callable
from dataclasses import dataclass

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.auth.permissions import PERMISSIONS
from app.modules.users.models import Role, User
from app.modules.users.plant_access import set_user_plant
from tests.conftest import TEST_ORIGIN
from tests.face_helpers import set_privacy
from tests.kiosk_helpers import Device, make_active_kiosk
from tests.people_helpers import PlantIds, client_for, create_plant
from tests.phone_api_helpers import (
    give_password,
    make_people,
    phone_client,
    sign_in,
    switch_phone,
)
from tests.role_matrix import (
    ANONYMOUS,
    CORPORATE_HEAD,
    DEVICE,
    IDENTITIES,
    OPEN,
    PHONE_EMPLOYEE,
    PLANT_HEAD,
    ROUTE_AUDIENCE,
    SUPER_ADMIN,
    Audience,
    expected_answer,
)

READINESS_PATH = "/api/v1/health/ready"
SESSION_ENDING_ROUTES = {
    ("POST", "/api/v1/auth/logout"),
    ("POST", "/api/v1/phone/logout"),
    ("POST", "/api/v1/phone/stop"),
}
# Path parameters that are not ids.
PATH_VALUES = {"day": "2026-10-28", "version": "1", "kind": "daily", "file_format": "xlsx"}
ROLE_OF_IDENTITY = {
    SUPER_ADMIN: Role.SUPER_ADMIN,
    CORPORATE_HEAD: Role.CORPORATE_HEAD,
    PLANT_HEAD: Role.PLANT_HEAD,
}


def all_routes(app: FastAPI) -> set[tuple[str, str]]:
    """Every (method, path) FastAPI serves, from the route list of the running app."""
    import fastapi.routing as fastapi_routing

    found: set[tuple[str, str]] = set()
    for context in fastapi_routing.iter_route_contexts(app.router.routes):
        if context.methods is None or context.path_format is None:
            continue
        for method in context.methods - {"HEAD", "OPTIONS"}:
            found.add((method, context.path_format))
    return found


def concrete_path(path_format: str) -> str:
    """The path with every {name} replaced: made-up ids, so a route answers 404 at most."""
    path = path_format
    while "{" in path:
        start, end = path.index("{"), path.index("}")
        name = path[start + 1 : end]
        path = path[:start] + PATH_VALUES.get(name, str(uuid.uuid4())) + path[end + 1 :]
    return path


@dataclass
class Callers:
    """One way to send a request for each of the six callers."""

    senders: dict[str, Callable[[str, str], tuple[int, str]]]


def build_callers(app: FastAPI, session: Session) -> Callers:
    boss = client_for(app, session, Role.SUPER_ADMIN, "boss")
    plant = create_plant(boss, session, "K134")
    senders: dict[str, Callable[[str, str], tuple[int, str]]] = {}

    def plain_sender(client: TestClient, extra: Callable[[str, str, bytes], dict] | None = None):
        def send(method: str, path: str) -> tuple[int, str]:
            body = b"{}" if method in ("POST", "PUT", "PATCH") else b""
            headers = {"Origin": TEST_ORIGIN, "Content-Type": "application/json"}
            if extra is not None:
                headers |= extra(method, path, body)
            answer = client.request(method, path, content=body or None, headers=headers)
            return answer.status_code, answer.text

        return send

    senders[ANONYMOUS] = plain_sender(TestClient(app, raise_server_exceptions=False))
    senders[SUPER_ADMIN] = plain_sender(boss)
    senders[CORPORATE_HEAD] = plain_sender(client_for(app, session, Role.CORPORATE_HEAD, "corp"))
    plant_client = client_for(app, session, Role.PLANT_HEAD, "plant")
    plant_user = session.scalars(select(User).where(User.username == "plant")).one()
    set_user_plant(session, plant_user, uuid.UUID(plant.id))
    session.commit()
    senders[PLANT_HEAD] = plain_sender(plant_client)

    device = Device()
    make_active_kiosk(session, plant, device)
    senders[DEVICE] = plain_sender(
        TestClient(app, raise_server_exceptions=False),
        lambda method, path, body: device.headers(method, path, body),
    )

    senders[PHONE_EMPLOYEE] = plain_sender(
        TestClient(app, raise_server_exceptions=False),
        _phone_cookie_header(app, session, boss, plant),
    )
    return Callers(senders)


def _phone_cookie_header(
    app: FastAPI, session: Session, boss: TestClient, plant: PlantIds
) -> Callable[[str, str, bytes], dict]:
    set_privacy(session)
    people = make_people(boss, session, plant)
    assert switch_phone(boss, people.face_id).status_code == 200
    give_password(session, people.face_id)
    phone = phone_client(app)
    assert sign_in(phone).status_code == 200
    token = phone.cookies.get("ups_phone")
    assert token
    return lambda method, path, body: {"Cookie": f"ups_phone={token}"}


# --- The table and the app agree -------------------------------------------------------------


def test_every_route_has_a_row_and_every_row_has_a_route(db_app: FastAPI) -> None:
    routes = all_routes(db_app)
    rows = set(ROUTE_AUDIENCE)

    assert sorted(routes - rows) == [], "a new route needs a row in tests/role_matrix.py"
    assert sorted(rows - routes) == [], "a row of tests/role_matrix.py has no route any more"


def capability_of_route(app: FastAPI) -> dict[tuple[str, str], str]:
    """The capability each `require(...)` route asks for, read from the route's dependencies."""
    import fastapi.routing as fastapi_routing

    found: dict[tuple[str, str], str] = {}
    for context in fastapi_routing.iter_route_contexts(app.router.routes):
        dependant = getattr(context.route, "dependant", None)
        capability = _find_capability(dependant) if dependant is not None else None
        if capability is not None and context.methods and context.path_format:
            for method in context.methods - {"HEAD", "OPTIONS"}:
                found[(method, context.path_format)] = capability
    return found


def _find_capability(dependant) -> str | None:
    for sub in dependant.dependencies:
        call = sub.call
        if getattr(call, "__qualname__", "") == "require.<locals>.check" and call.__closure__:
            names = call.__code__.co_freevars
            values = [cell.cell_contents for cell in call.__closure__]
            return dict(zip(names, values, strict=True))["capability"].name
        deeper = _find_capability(sub)
        if deeper is not None:
            return deeper
    return None


def test_the_table_agrees_with_permissions_py(db_app: FastAPI) -> None:
    """The roles a row lets in are exactly the roles of the capability the route asks for."""
    from tests.role_matrix import ALLOWED

    wrong = []
    for key, capability in capability_of_route(db_app).items():
        roles_in_permissions = {
            {Role.SUPER_ADMIN: SUPER_ADMIN, Role.CORPORATE_HEAD: CORPORATE_HEAD}.get(
                role, PLANT_HEAD
            )
            for role in PERMISSIONS[_capability(capability)]
        }
        if set(ALLOWED[ROUTE_AUDIENCE[key]]) != roles_in_permissions:
            wrong.append((key, capability))
    assert wrong == []


def _capability(name: str):
    from app.modules.auth.permissions import Capability

    return Capability[name]


# --- Behaviour: each caller against each route ------------------------------------------------


@pytest.mark.parametrize("identity", IDENTITIES)
def test_every_route_answers_each_caller_as_the_table_says(
    db_app: FastAPI, db_session: Session, identity: str
) -> None:
    callers = build_callers(db_app, db_session)
    send = callers.senders[identity]
    # Logging out ends the session, so those routes are called last.
    ordered = sorted(ROUTE_AUDIENCE, key=lambda key: key in SESSION_ENDING_ROUTES)

    wrong = []
    session_ended = False
    for method, path_format in ordered:
        if session_ended and (method, path_format) in SESSION_ENDING_ROUTES:
            continue  # the first ending route did its work; the session is gone for the rest
        expected = expected_answer(ROUTE_AUDIENCE[(method, path_format)], identity)
        status, text = send(method, concrete_path(path_format))
        if (method, path_format) in SESSION_ENDING_ROUTES and status < 400:
            session_ended = True
        if status == 503 and path_format == READINESS_PATH:
            continue  # the readiness check answers 503 by design when the database is away
        if status >= 500:
            wrong.append((method, path_format, status, "server error"))
        elif expected == OPEN and status in (401, 403):
            wrong.append((method, path_format, status, f"expected let in: {_code(text)}"))
        elif expected != OPEN and status != expected:
            wrong.append((method, path_format, status, f"expected {expected}: {_code(text)}"))
    assert wrong == []


def _code(text: str) -> str:
    try:
        return str(json.loads(text)["error"]["code"])
    except ValueError, KeyError, TypeError:
        return text[:60]


def test_the_audience_of_a_route_never_lets_a_phone_or_a_device_into_the_admin_area() -> None:
    admin_audiences = {Audience.SUPER, Audience.SUPER_CORP, Audience.ALL_ADMINS}
    for key, audience in ROUTE_AUDIENCE.items():
        if audience in admin_audiences:
            assert expected_answer(audience, DEVICE) == 401, key
            assert expected_answer(audience, PHONE_EMPLOYEE) == 401, key
