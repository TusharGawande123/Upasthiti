"""M6 AC-M6-16: every download checks the role, is never cached, and has a safe file name.

The files of one plant (reports, muster, punch export, import template, gate poster) are asked
for with the fixture of the M5 report tests. The file name may hold letters, digits, dots,
dashes and underscores only: no quote, no line break, no path, no name of a person.
"""

import re

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.modules.org.models import Plant
from tests.conftest import TEST_ORIGIN
from tests.test_m5_reports import FRIDAY, pinned_clock, world  # noqa: F401  (fixtures)

pytestmark = pytest.mark.time_sensitive

SAFE_DISPOSITION = re.compile(r'^(attachment|inline); filename="[A-Za-z0-9._-]+"$')
MAGIC = {"xlsx": b"PK", "pdf": b"%PDF"}
RANGE = {"date_from": "2026-10-26", "date_to": FRIDAY.isoformat()}


def downloads_of(plant_id: str) -> list[tuple[str, str, dict[str, str]]]:
    """(name, path, query) of every GET download of the plant."""
    day = {"date": FRIDAY.isoformat(), "plant_id": plant_id}
    month = {"month": "2026-10", "plant_id": plant_id}
    ranged = RANGE | {"plant_id": plant_id}
    items: list[tuple[str, str, dict[str, str]]] = []
    for file_format in ("xlsx", "pdf"):
        items += [
            (f"daily-muster.{file_format}", f"/api/v1/reports/daily-muster.{file_format}", day),
            (f"register.{file_format}", f"/api/v1/reports/register.{file_format}", month),
            (
                f"contractor-hours.{file_format}",
                f"/api/v1/reports/contractor-hours.{file_format}",
                month,
            ),
            (
                f"conversions.{file_format}",
                f"/api/v1/reports/conversions.{file_format}",
                ranged,
            ),
        ]
        for kind in ("late-early-overtime", "exceptions", "rejected-punches", "corrections"):
            items.append((f"{kind}.{file_format}", f"/api/v1/reports/{kind}.{file_format}", ranged))
    items += [
        ("muster.pdf", "/api/v1/muster.pdf", {"plant_id": plant_id}),
        ("punch export", "/api/v1/punches/export.xlsx", {"plant_id": plant_id}),
        ("import template", "/api/v1/employees/import/template.xlsx", {}),
        ("gate poster", f"/api/v1/plants/{plant_id}/gate-poster.pdf", {}),
    ]
    return items


def file_type_of(path: str) -> str:
    return "pdf" if path.endswith(".pdf") else "xlsx"


def test_every_download_is_not_cached_and_has_a_safe_file_name(world: dict) -> None:  # noqa: F811
    """M6 AC-M6-16: no-store, a plain file name, and bytes of the type the name promises."""
    wrong = []
    for name, path, query in downloads_of(world["plant"].id):
        answer = world["boss"].get(path, params=query)
        if answer.status_code != 200:
            wrong.append((name, "status", answer.status_code))
            continue
        if answer.headers.get("cache-control") != "no-store":
            wrong.append((name, "cache-control", answer.headers.get("cache-control")))
        disposition = answer.headers.get("content-disposition", "")
        if not SAFE_DISPOSITION.match(disposition):
            wrong.append((name, "content-disposition", disposition))
        if not answer.content.startswith(MAGIC[file_type_of(path)]):
            wrong.append((name, "bytes", answer.content[:8]))
    assert wrong == []


def test_nobody_downloads_without_a_sign_in(world: dict, db_app: FastAPI) -> None:  # noqa: F811
    """M6 AC-M6-16: the role is checked before any file is made."""
    nobody = TestClient(db_app, raise_server_exceptions=False, headers={"Origin": TEST_ORIGIN})

    wrong = []
    for name, path, query in downloads_of(world["plant"].id):
        answer = nobody.get(path, params=query)
        if answer.status_code != 401 or "content-disposition" in answer.headers:
            wrong.append((name, answer.status_code))
    assert wrong == []


def test_a_plant_head_gets_no_file_of_another_plant(world: dict) -> None:  # noqa: F811
    """M6 AC-M6-16 and AC-M6-10: the file of another plant is refused, not made empty."""
    other_plant = world["other"].id
    refused = []
    for name, path, query in downloads_of(other_plant):
        if "plant_id" not in query and other_plant not in path:
            continue  # the import template holds no plant data
        answer = world["head"].get(path, params=query)
        if answer.status_code not in (403, 404):
            refused.append((name, answer.status_code))
    assert refused == []


def test_the_file_name_never_carries_text_a_user_typed(world: dict) -> None:  # noqa: F811
    """M6 AC-M6-16: a plant code with a quote or line break cannot be made, so it cannot reach a
    Content-Disposition header."""
    for bad_code in ('AB"X', "AB\r\nSet-Cookie: x=1", "../ETC", "AB;C"):
        answer = world["boss"].post("/api/v1/plants", json={"name": "Bad", "code": bad_code})
        assert answer.status_code in (409, 422), (bad_code, answer.status_code)
    session = world["session"]
    codes = [code for (code,) in session.query(Plant.code).all()]
    assert all(re.fullmatch(r"[A-Z0-9]{2,10}", code) for code in codes)


def test_an_upload_above_the_limit_is_refused(world: dict) -> None:  # noqa: F811
    """M6 AC-M6-16: the Excel import takes 2 MB; a 3.5 MB file is stopped as too large."""
    too_big = b"PK" + b"0" * (3_500_000)

    answer = world["boss"].post(
        "/api/v1/employees/import",
        files={"file": ("big.xlsx", too_big, "application/octet-stream")},
    )

    assert answer.status_code == 413
    assert answer.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"
