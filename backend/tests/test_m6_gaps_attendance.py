# ruff: noqa: F811  (the `world` fixture is imported from the other attendance test)
"""M6 gap tests for M5 (AC-13) and M5c (AC-11, AC-19, AC-23, AC-25): the flagged-punch review
recomputes the day, the old plant keeps the old days, the old contractor keeps the old hours, a
conversion leaves the phone switches alone and its audit row holds the reason. (M5c AC-24, the
import that never converts, is in test_import_and_contractors_api.py.) Real PostgreSQL, fake
data, the clock pinned to Mon 02/11/2026 12:00 IST."""

import io
import uuid
from datetime import date

import openpyxl
import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.audit.models import AuditLog
from app.modules.employees.models import Employee
from app.modules.kiosks.models import KioskDevice
from app.modules.phone.models import PhoneAccess, PhoneAccount
from app.modules.punches.models import Punch
from tests.clock_helpers import ist
from tests.test_m5_attendance_api import (  # noqa: F401  (world is a fixture)
    FRIDAY,
    MONDAY,
    NOW,
    daily,
    make_plant,
    pinned_clock,
    punch,
    work_a_day,
    world,
)

pytestmark = pytest.mark.time_sensitive

EMPLOYEES = "/api/v1/employees"


def day_of(world: dict, who: str, code: str, day: date) -> dict:
    items = daily(world, who, day).json()["items"]
    return next(item["day"] for item in items if item["employee"]["code"] == code)


def test_a_flagged_in_is_used_then_not_accepted_recomputes_the_day_at_once(world: dict) -> None:
    """M5 AC-13: uses_unchecked_flag is true while the flag is unchecked; "not accepted" removes it
    and the day is recomputed in the same request."""
    kiosk: KioskDevice = world["kiosk"]
    flagged_in = Punch(  # a punch row is append-only, so it is written flagged from the start
        client_punch_id=uuid.uuid4(),
        kiosk_id=kiosk.id,
        plant_id=kiosk.plant_id,
        employee_id=world["people"]["P-1"],
        method="face",
        direction="in",
        decision="flagged",
        reason_codes=["LOCATION_AT_EDGE"],
        server_received_at=ist(FRIDAY, 9, 0),
        was_offline=False,
    )
    world["session"].add(flagged_in)
    world["session"].commit()
    punch(world, "P-1", ist(FRIDAY, 17, 0), "out")

    before = day_of(world, "boss", "P-1", FRIDAY)
    assert before["uses_unchecked_flag"] is True
    assert before["first_in"] is not None and before["worked_min"] == 480

    review = world["boss"].post(
        f"/api/v1/punches/{flagged_in.id}/reviews",
        json={
            "action": "not_accepted",
            "reason": "The phone was at the canteen",
            "expected_latest_review_id": None,
        },
    )
    assert review.status_code == 201, review.text

    after = day_of(world, "boss", "P-1", FRIDAY)  # no waiting: the same request recomputed it
    assert after["uses_unchecked_flag"] is False
    assert after["first_in"] is None and after["worked_min"] == 0


def test_a_transferred_person_is_in_each_plant_register_only_for_the_days_there(
    world: dict,
) -> None:
    """M5c AC-11: transferred on day D (today): plant A is filled up to D-1 and has a dash from
    D, plant B has the days from D only."""
    session: Session = world["session"]
    destination = make_plant(world["boss"], session, "TP1")
    work_a_day(world, "P-1", date(2026, 10, 28), (9, 0), (17, 0))
    transfer = world["boss"].post(
        f"{EMPLOYEES}/{world['people']['P-1']}/transfer",
        json={
            "to_plant_id": destination.id,
            "category_id": destination.staff_id,
            "shift_id": destination.shift_id,
            "effective_from": MONDAY.isoformat(),
            "reason": "Needed at TP1",
        },
    )
    assert transfer.status_code == 200, transfer.text

    def cells_of_p1(plant_id: str) -> dict[str, str]:
        answer = world["boss"].get(
            "/api/v1/attendance/register-range",
            params={"plant_id": plant_id, "date_from": "2026-10-28", "date_to": "2026-11-02"},
        )
        assert answer.status_code == 200, answer.text
        row = [row for row in answer.json()["items"] if row["employee"]["code"] == "P-1"]
        return {cell["date"]: cell["code"] for cell in row[0]["days"]} if row else {}

    plant_a = cells_of_p1(world["plant"].id)
    plant_b = cells_of_p1(destination.id)
    assert plant_a["2026-10-28"] == "P"
    assert plant_a.get("2026-11-02", "–") == "–"
    assert plant_b.get("2026-10-28", "–") == "–" and plant_b.get("2026-10-30", "–") == "–"
    assert plant_b["2026-11-02"] != "–"


def test_the_contractor_report_of_the_earlier_month_still_lists_a_converted_worker(
    world: dict,
) -> None:
    """M5c AC-19: the conversion clears contractor_id; earlier days stay under the old one."""
    session: Session = world["session"]
    boss = world["boss"]
    contractor = boss.post("/api/v1/contractors", json={"name": "Fake Staffing"})
    assert contractor.status_code == 201, contractor.text
    employee_id = world["people"]["T-1"]
    assigned = boss.patch(
        f"{EMPLOYEES}/{employee_id}", json={"contractor_id": contractor.json()["id"]}
    )
    assert assigned.status_code == 200, assigned.text
    work_a_day(world, "T-1", date(2026, 10, 27), (9, 0), (17, 0))
    converted = boss.post(
        f"{EMPLOYEES}/{employee_id}/convert-to-permanent",
        json={"effective_from": "2026-11-02", "reason": "Permanent offer"},
    )
    assert converted.status_code == 200, converted.text
    session.expire_all()
    employee = session.get(Employee, employee_id)
    assert employee is not None and employee.contractor_id is None

    report = boss.get(
        "/api/v1/reports/contractor-hours.xlsx",
        params={"month": "2026-10", "plant_id": world["plant"].id},
    )

    assert report.status_code == 200, report.text
    sheet = openpyxl.load_workbook(io.BytesIO(report.content)).worksheets[0]
    text = " ".join(str(cell.value) for row in sheet.iter_rows() for cell in row if cell.value)
    assert "Fake Staffing" in text and "T-1" in text


def test_a_conversion_leaves_the_phone_switches_and_password_as_they_were(world: dict) -> None:
    """M5c AC-23: phone punching, outside work and the phone sign-in are unchanged."""
    session: Session = world["session"]
    employee_id = world["people"]["T-1"]
    session.add(
        PhoneAccess(
            employee_id=employee_id,
            phone_punch_enabled=True,
            phone_changed_at=NOW,
            outside_work_allowed=True,
        )
    )
    session.add(
        PhoneAccount(
            employee_id=employee_id,
            password_hash="argon2-hash-of-a-fake-password",  # noqa: S106 (fake data)
            password_set_at=NOW,
            proof_kind="card",
        )
    )
    session.commit()

    converted = world["boss"].post(
        f"{EMPLOYEES}/{employee_id}/convert-to-permanent",
        json={"effective_from": "2026-11-02", "reason": "Permanent offer"},
    )

    assert converted.status_code == 200, converted.text
    session.expire_all()
    access = session.scalars(
        select(PhoneAccess).where(PhoneAccess.employee_id == employee_id)
    ).one()
    account = session.scalars(
        select(PhoneAccount).where(PhoneAccount.employee_id == employee_id)
    ).one()
    assert (access.phone_punch_enabled, access.outside_work_allowed) == (True, True)
    assert account.password_hash == "argon2-hash-of-a-fake-password"  # noqa: S105
    assert account.new_password_required_at is None and account.locked_until is None


def test_the_conversion_audit_row_holds_the_reason(world: dict) -> None:
    """M5c AC-25: a conversion always adds an audit entry with the reason."""
    employee_id = world["people"]["T-1"]

    converted = world["boss"].post(
        f"{EMPLOYEES}/{employee_id}/convert-to-permanent",
        json={"effective_from": "2026-11-02", "reason": "Offer letter signed"},
    )

    assert converted.status_code == 200, converted.text
    row = (
        world["session"]
        .scalars(
            select(AuditLog).where(
                AuditLog.action == "employee.convert", AuditLog.entity_id == employee_id
            )
        )
        .one()
    )
    assert row.reason == "Offer letter signed"


def test_the_late_early_overtime_report_has_overtime_for_temporary_workers_only(
    world: dict,
) -> None:
    """M5c AC-29: temporary overtime stays in the report; a permanent person shows late and early
    exit but never an overtime figure, and a permanent person with only long hours has no row."""
    work_a_day(world, "T-1", FRIDAY, (8, 30), (19, 30))  # temporary: 150 minutes of overtime
    work_a_day(world, "P-1", FRIDAY, (9, 45), (22, 0))  # permanent: late, no overtime figure
    work_a_day(world, "P-2", FRIDAY, (9, 0), (22, 0))  # permanent, on time: no row at all

    report = world["boss"].get(
        "/api/v1/reports/late-early-overtime.xlsx",
        params={
            "plant_id": world["plant"].id,
            "date_from": FRIDAY.isoformat(),
            "date_to": FRIDAY.isoformat(),
        },
    )

    assert report.status_code == 200, report.text
    sheet = openpyxl.load_workbook(io.BytesIO(report.content)).worksheets[-1]
    rows = {
        row[0]: row
        for row in sheet.iter_rows(values_only=True)
        if row[0] in ("T-1", "P-1", "P-2") and row[2] is not None
    }
    assert set(rows) == {"T-1", "P-1"}
    assert rows["T-1"][10] == 150  # the columns come in pairs: minutes, then HH:MM
    assert rows["P-1"][6] and not rows["P-1"][10]
