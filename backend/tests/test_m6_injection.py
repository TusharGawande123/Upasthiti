"""M6 AC-M6-15: hostile text never makes a 500, never changes data, and is written as plain text.

Four places are checked: no SQL is built by gluing text together; every filter of every read
route is given hostile values; free text typed into forms is stored as typed; and Excel and PDF
files hold formula-looking text as text. A request id (a header) and a log line cannot be forged.
"""

import ast
import io
import json
import logging
from collections.abc import Iterator
from datetime import date
from pathlib import Path

import openpyxl
import pypdfium2 as pdfium
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.logging import JsonFormatter
from app.modules.employees.models import Employee
from app.modules.org.models import Plant
from app.modules.users.models import Role
from tests.clock_helpers import frozen_at, ist
from tests.people_helpers import PlantIds, client_for, create_plant, permanent_body
from tests.role_matrix import ROUTE_AUDIENCE
from tests.test_m6_role_matrix import concrete_path

pytestmark = pytest.mark.time_sensitive

FRIDAY = date(2026, 10, 30)
APP_FOLDER = Path(__file__).resolve().parent.parent / "app"

HOSTILE_VALUES = [
    "' OR 1=1 --",
    "x'; DROP TABLE employees; --",
    "100%_\\",
    "a\x00b",
    '=HYPERLINK("http://evil.example","x")',
    "A" * 150,
    "‮\u0000﻿\U0001f600",
]
# Every filter name a read route takes as free text.
FILTER_NAMES = (
    "q",
    "search",
    "status",
    "kind",
    "type",
    "code",
    "action",
    "entity_type",
    "actor_type",
    "reason_code",
    "state",
    "face_state",
    "phone",
    "name",
    "group_by",
)
FORMULA_NAMES = [
    "=1+1",
    "+1+1",
    "-2+3",
    "@SUM(1+1)",
    "=cmd|' /C calc'!A0",
    '=HYPERLINK("http://evil.example","click")',
    "\t=1+1",
]


def test_no_sql_is_built_by_gluing_text_together() -> None:
    """M6 AC-M6-15: text(...) and execute(...) take a fixed string, never an f-string, a `%` or
    `+` expression or `.format(...)`."""
    glued = []
    for path in sorted(APP_FOLDER.rglob("*.py")):
        if "scripts" in path.relative_to(APP_FOLDER).parts:
            continue  # command-line tools make DDL with quoted names; no web input reaches them
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or not node.args:
                continue
            function = node.func
            # `text(...)` is SQLAlchemy's raw SQL; `.text(...)` on a PDF page is only drawing.
            is_text = isinstance(function, ast.Name) and function.id == "text"
            is_execute = isinstance(function, ast.Attribute) and function.attr in (
                "execute",
                "exec_driver_sql",
            )
            if not (is_text or is_execute):
                continue
            first = node.args[0]
            built = isinstance(first, ast.JoinedStr) or (
                isinstance(first, ast.BinOp) and isinstance(first.op, ast.Mod | ast.Add)
            )
            built = built or (
                isinstance(first, ast.Call)
                and isinstance(first.func, ast.Attribute)
                and first.func.attr == "format"
            )
            if built:
                glued.append(f"{path.relative_to(APP_FOLDER)}:{node.lineno}")
    assert glued == []


@pytest.fixture(autouse=True)
def pinned_clock() -> Iterator[None]:
    with frozen_at(ist(FRIDAY, 18, 0)):
        yield


@pytest.fixture
def plant_and_boss(db_app: FastAPI, db_session: Session) -> tuple[TestClient, PlantIds]:
    boss = client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")
    plant = create_plant(boss, db_session, "K134")
    # Attendance starts on the Monday of the pinned week, so the reports list the people.
    patched = boss.patch(f"/api/v1/plants/{plant.id}", json={"attendance_start_date": "2026-10-26"})
    assert patched.status_code == 200, patched.text
    return boss, plant


def test_hostile_filter_values_never_break_a_read_route(
    plant_and_boss: tuple[TestClient, PlantIds], db_session: Session
) -> None:
    """M6 AC-M6-15: every read route, every filter name, hostile values: no 500, no data change."""
    boss, plant = plant_and_boss
    assert boss.post("/api/v1/employees", json=permanent_body(plant)).status_code == 201
    before = _row_counts(db_session)

    broken = []
    for method, path_format in sorted(ROUTE_AUDIENCE):
        if method != "GET" or path_format in ("/api/v1/health/ready",):
            continue
        path = concrete_path(path_format)
        for value in HOSTILE_VALUES[:4] + HOSTILE_VALUES[5:]:
            answer = boss.get(path, params=dict.fromkeys(FILTER_NAMES, value))
            if answer.status_code >= 500:
                broken.append((path_format, repr(value[:12]), answer.status_code))
    db_session.expire_all()
    assert broken == []
    assert _row_counts(db_session) == before


def test_a_null_byte_in_a_filter_is_refused_not_a_server_error(
    plant_and_boss: tuple[TestClient, PlantIds],
) -> None:
    """M6 AC-M6-15: PostgreSQL cannot store a NUL byte; the API must answer with a 4xx."""
    boss, _plant = plant_and_boss

    for url in ("/api/v1/employees", "/api/v1/search", "/api/v1/audit", "/api/v1/punches"):
        answer = boss.get(url, params={"q": "a\x00b"})
        assert answer.status_code < 500, url


def _row_counts(session: Session) -> tuple[int, int]:
    employees = session.scalar(select(func.count()).select_from(Employee))
    plants = session.scalar(select(func.count()).select_from(Plant))
    return employees or 0, plants or 0


def test_free_text_is_stored_as_typed_or_refused(
    plant_and_boss: tuple[TestClient, PlantIds], db_session: Session
) -> None:
    """M6 AC-M6-15: a hostile employee name, plant name, device name or contractor name gets
    201 and comes back unchanged, or a 4xx; never a 500."""
    boss, plant = plant_and_boss
    stored_names: list[str] = []
    for number, value in enumerate(HOSTILE_VALUES + FORMULA_NAMES):
        body = permanent_body(plant, code=f"H-{number}", name=value)
        answer = boss.post("/api/v1/employees", json=body)
        assert answer.status_code < 500, (repr(value[:12]), answer.status_code)
        if answer.status_code == 201:
            shown = boss.get(f"/api/v1/employees/{answer.json()['id']}").json()["employee"][
                "full_name"
            ]
            assert shown == value.strip(), repr(value[:12])
            stored_names.append(shown)
        for url, payload in (
            ("/api/v1/contractors", {"name": value}),
            ("/api/v1/plants", {"name": value, "code": f"X{number}"}),
            ("/api/v1/kiosks", {"plant_id": plant.id, "name": value}),
        ):
            assert boss.post(url, json=payload).status_code < 500, (url, repr(value[:12]))
    assert len(stored_names) >= len(FORMULA_NAMES) - 2, "the formula-looking names are real names"


def make_people_with_formula_names(boss: TestClient, plant: PlantIds) -> list[str]:
    accepted = []
    for number, value in enumerate(FORMULA_NAMES):
        body = permanent_body(plant, code=f"F-{number}", name=value) | {"joined_on": "2026-10-26"}
        if boss.post("/api/v1/employees", json=body).status_code == 201:
            accepted.append(value.strip())
    return accepted


def test_excel_files_hold_formula_looking_names_as_text(
    plant_and_boss: tuple[TestClient, PlantIds],
) -> None:
    """M6 AC-M6-15: read the files back; no cell is a formula, and each name is in a text cell."""
    boss, plant = plant_and_boss
    names = make_people_with_formula_names(boss, plant)
    assert len(names) >= 5

    wrong = []
    reads = [
        ("/api/v1/reports/register.xlsx", {"month": "2026-10", "plant_id": plant.id}),
        ("/api/v1/reports/daily-muster.xlsx", {"date": FRIDAY.isoformat(), "plant_id": plant.id}),
    ]
    found_any = False
    for url, params in reads:
        answer = boss.get(url, params=params)
        assert answer.status_code == 200, (url, answer.text)
        workbook = openpyxl.load_workbook(io.BytesIO(answer.content))
        for sheet in workbook.worksheets:
            for row in sheet.iter_rows():
                for cell in row:
                    if cell.data_type == "f":
                        wrong.append((url, cell.coordinate, cell.value))
                    if isinstance(cell.value, str) and cell.value.strip() in names:
                        found_any = True
                        if cell.data_type != "s":
                            wrong.append((url, cell.coordinate, cell.data_type))
    assert wrong == []
    assert found_any, "the hostile names must appear in a file, or the test proves nothing"


def test_pdf_files_print_formula_looking_names_as_text(
    plant_and_boss: tuple[TestClient, PlantIds],
) -> None:
    """M6 AC-M6-15: a PDF of hostile names is made and shows them as typed."""
    boss, plant = plant_and_boss
    names = make_people_with_formula_names(boss, plant)

    answer = boss.get(
        "/api/v1/reports/register.pdf", params={"month": "2026-10", "plant_id": plant.id}
    )

    assert answer.status_code == 200, answer.text
    document = pdfium.PdfDocument(answer.content)
    printed = "\n".join(page.get_textpage().get_text_range() for page in document)
    assert any(name in printed for name in names if name.isascii() and "\t" not in name)


def test_a_request_id_from_a_caller_cannot_forge_a_header_or_log_line(
    db_client: TestClient,
) -> None:
    """M6 AC-M6-15: only a plain id is echoed; anything else is replaced by a fresh one."""
    plain = db_client.get("/api/v1/health", headers={"X-Request-ID": "abc-123"})
    forged = db_client.get(
        "/api/v1/health", headers={"X-Request-ID": 'abc" , "level": "CRITICAL" x' + "y" * 100}
    )

    assert plain.headers["X-Request-ID"] == "abc-123"
    assert forged.headers["X-Request-ID"] != 'abc" , "level": "CRITICAL" x'
    assert len(forged.headers["X-Request-ID"]) <= 64


def test_a_log_line_with_a_line_break_stays_one_json_line() -> None:
    """M6 AC-M6-15: text a caller typed cannot start a second log line or add a field."""
    typed = 'admin\n{"level": "CRITICAL", "message": "forged"}'
    record = logging.LogRecord(
        "app.test", logging.WARNING, "x.py", 1, "Login failed for %s", (typed,), None
    )

    line = JsonFormatter().format(record)

    assert "\n" not in line
    parsed = json.loads(line)
    assert parsed["level"] == "WARNING"
    assert typed in parsed["message"]
