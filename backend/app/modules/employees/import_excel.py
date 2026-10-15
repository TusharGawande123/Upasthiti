"""Excel import of new employees (SRS FR-09, spec §7 rule 12) and its template.

How an import works:
1. The admin downloads the template (headers, dropdowns, a notes sheet, two fake rows).
2. The filled file is read as plain values: formulas are never run, and a text cell that
   starts with = + - or @ is refused (spreadsheet injection).
3. Every row is checked with the same rules as the form, plus duplicate codes in the file.
4. Nothing is saved unless every row is correct (all-or-nothing).
"""

import io
import re
import uuid
import zipfile
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

import xlsxwriter
from openpyxl import load_workbook
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.modules.contractors.models import Contractor
from app.modules.employees.rules import (
    EmployeeValues,
    check_new_code,
    check_values,
    clean_code,
    default_punch_method,
)
from app.modules.org.models import Department, EmployeeCategory, Plant, Shift

MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_ROWS = 2000
COLUMNS = (
    "employee_code",
    "full_name",
    "type",
    "plant_code",
    "category",
    "department",
    "shift",
    "punch_method",
    "contractor",
    "hourly_rate",
    "ot_rate_per_hour",
    "joined_on",
)
REQUIRED_COLUMNS = (
    "employee_code",
    "full_name",
    "type",
    "plant_code",
    "category",
    "shift",
    "joined_on",
)
TEXT_COLUMNS = (
    "employee_code",
    "full_name",
    "plant_code",
    "category",
    "department",
    "shift",
    "contractor",
)
DANGEROUS_FIRST_CHARACTERS = ("=", "+", "-", "@")
DATE_PATTERN = re.compile(r"^(\d{2})/(\d{2})/(\d{4})$")


@dataclass
class RowError:
    row: int  # the Excel row number, as the admin sees it
    column: str
    code: str
    message: str


@dataclass
class CheckedImport:
    rows: list[dict[str, Any]] = field(default_factory=list)  # cleaned rows, JSON-safe
    values: list[EmployeeValues] = field(default_factory=list)
    errors: list[RowError] = field(default_factory=list)


# --- Template --------------------------------------------------------------------------------


def build_template(session: Session) -> bytes:
    plant_codes = list(session.scalars(select(Plant.code).where(Plant.is_active.is_(True))))
    buffer = io.BytesIO()
    workbook = xlsxwriter.Workbook(buffer, {"in_memory": True})
    sheet = workbook.add_worksheet("Employees")
    header = workbook.add_format({"bold": True, "bg_color": "#EAEEFB", "border": 1})
    for column_index, name in enumerate(COLUMNS):
        sheet.write(0, column_index, name, header)
        sheet.set_column(column_index, column_index, 18)

    # Dropdowns help the admin type valid values.
    last_row = MAX_ROWS + 1
    sheet.data_validation(
        1, 2, last_row, 2, {"validate": "list", "source": ["permanent", "temporary"]}
    )
    sheet.data_validation(1, 7, last_row, 7, {"validate": "list", "source": ["face", "qr"]})
    if plant_codes:
        sheet.data_validation(1, 3, last_row, 3, {"validate": "list", "source": plant_codes[:50]})

    # Two fake example rows (the repository is public: never real people).
    example_plant = plant_codes[0] if plant_codes else "K134"
    examples = (
        (
            "9001",
            "Example Permanent",
            "permanent",
            example_plant,
            "Staff",
            "",
            "General",
            "face",
            "",
            "",
            "150.00",
            "01/11/2026",
        ),
        (
            "9002",
            "Example Temporary",
            "temporary",
            example_plant,
            "Helper",
            "",
            "General",
            "qr",
            "",
            "85.00",
            "",
            "01/11/2026",
        ),
    )
    for row_index, example in enumerate(examples, start=1):
        for column_index, value in enumerate(example):
            sheet.write_string(row_index, column_index, value)

    notes = workbook.add_worksheet("Notes")
    for line_index, line in enumerate(
        (
            "Fill one row per NEW employee. Delete the two example rows first.",
            "employee_code: the company's existing code (up to 12 letters, digits, - or /).",
            "type: permanent or temporary. Temporary workers need an hourly_rate.",
            "plant_code: e.g. K134. category, department, shift: names as on the plant's page.",
            "punch_method: face (permanent) or qr (temporary); empty = the usual one.",
            "contractor: only for temporary workers; the name as in Contractors.",
            "Rates in rupees with up to 2 decimals. joined_on as DD/MM/YYYY.",
            "Do not type formulas. Nothing is saved unless every row is correct.",
        )
    ):
        notes.write_string(line_index, 0, line)
    notes.set_column(0, 0, 100)
    workbook.close()
    return buffer.getvalue()


# --- Reading and checking --------------------------------------------------------------------


MAX_UNPACKED_BYTES = 20 * 1024 * 1024  # an .xlsx is a zip; refuse one that unpacks huge
MAX_ROWS_SCANNED = MAX_ROWS + 500  # rows looked at, empty lines included


def _refuse_zip_bomb(file_bytes: bytes) -> None:
    try:
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as archive:
            unpacked = sum(item.file_size for item in archive.infolist())
    except zipfile.BadZipFile:
        raise ApiError("IMPORT_FILE_INVALID", "Use the Upasthiti template (.xlsx).", 422) from None
    if unpacked > MAX_UNPACKED_BYTES:
        raise ApiError("IMPORT_TOO_LARGE", "The file is larger than 2 MB.", 413)


def read_rows(file_bytes: bytes) -> list[tuple[int, dict[str, Any]]]:
    """The data rows as (excel row number, {column: value}). Refuses a wrong file."""
    if len(file_bytes) > MAX_FILE_BYTES:
        raise ApiError("IMPORT_TOO_LARGE", "The file is larger than 2 MB.", 413)
    _refuse_zip_bomb(file_bytes)
    try:
        # read_only + data_only=False: formulas come back as text and are never calculated.
        workbook = load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=False)
    except Exception:
        raise ApiError("IMPORT_FILE_INVALID", "Use the Upasthiti template (.xlsx).", 422) from None
    sheet = workbook.worksheets[0]
    rows = sheet.iter_rows(values_only=True)
    header = [str(cell).strip() if cell is not None else "" for cell in next(rows, ())]
    if tuple(header[: len(COLUMNS)]) != COLUMNS:
        raise ApiError("IMPORT_FILE_INVALID", "The column headers do not match the template.", 422)

    data: list[tuple[int, dict[str, Any]]] = []
    for row_number, cells in enumerate(rows, start=2):
        if row_number > MAX_ROWS_SCANNED:
            # A tiny file can hold millions of empty rows; stop reading instead of looping.
            raise ApiError("IMPORT_TOO_LARGE", "At most 2,000 rows per file.", 413)
        values: dict[str, Any] = dict(zip(COLUMNS, cells[: len(COLUMNS)], strict=False))
        if all(value in (None, "") for value in values.values()):
            continue  # skip empty lines
        data.append((row_number, values))
        if len(data) > MAX_ROWS:
            raise ApiError("IMPORT_TOO_LARGE", "At most 2,000 rows per file.", 413)
    workbook.close()
    return data


def check_rows(session: Session, raw_rows: list[tuple[int, dict[str, Any]]]) -> CheckedImport:
    result = CheckedImport()
    lookups = _Lookups(session)
    codes_seen: dict[str, int] = {}

    for row_number, raw in raw_rows:
        errors_before = len(result.errors)
        cleaned = _clean_row(row_number, raw, result.errors)
        if len(result.errors) > errors_before:
            continue
        values = _resolve(row_number, cleaned, lookups, result.errors)
        if values is None:
            continue

        code = values.employee_code
        if code in codes_seen:
            result.errors.append(
                RowError(
                    row_number,
                    "employee_code",
                    "EMPLOYEE_CODE_DUPLICATE_IN_FILE",
                    f"Code {code} is also in row {codes_seen[code]}.",
                )
            )
            continue
        codes_seen[code] = row_number

        try:
            check_new_code(session, code)
            values = check_values(session, values)
        except ApiError as error:
            column = str(error.details.get("field", "row"))
            result.errors.append(
                RowError(row_number, _column_name(column), error.code, error.message)
            )
            continue
        result.rows.append(cleaned)
        result.values.append(values)
    return result


def values_from_saved_rows(session: Session, rows: list[dict[str, Any]]) -> CheckedImport:
    """Rebuild a pending import (a Corporate Head's request) and check it again."""
    return check_rows(session, [(index + 2, row) for index, row in enumerate(rows)])


# --- Helpers ----------------------------------------------------------------------------------


class _Lookups:
    """Finds plants, categories, shifts… by the names typed in the file (case-insensitive)."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def plant(self, code: str) -> Plant | None:
        return self.session.scalar(select(Plant).where(Plant.code == code.upper()))

    def in_plant(
        self,
        model: type[EmployeeCategory] | type[Department] | type[Shift],
        plant_id: uuid.UUID,
        name: str,
    ) -> uuid.UUID | None:
        return self.session.scalar(
            select(model.id).where(
                model.plant_id == plant_id, func.lower(model.name) == name.lower()
            )
        )

    def contractor(self, name: str) -> uuid.UUID | None:
        return self.session.scalar(
            select(Contractor.id).where(func.lower(Contractor.name) == name.lower())
        )


def _clean_row(row_number: int, raw: dict[str, Any], errors: list[RowError]) -> dict[str, Any]:
    cleaned: dict[str, Any] = {}
    for column in COLUMNS:
        value = raw.get(column)
        if isinstance(value, str):
            value = value.strip()
            if value.startswith(DANGEROUS_FIRST_CHARACTERS) and column in TEXT_COLUMNS + (
                "type",
                "punch_method",
            ):
                errors.append(
                    RowError(row_number, column, "IMPORT_CELL_FORMULA", "Formulas are not allowed.")
                )
                continue
        if value in (None, "") and column in REQUIRED_COLUMNS:
            errors.append(RowError(row_number, column, "VALUE_REQUIRED", "This value is needed."))
            continue
        cleaned[column] = _to_text_or_date(column, value, row_number, errors)
    return cleaned


def _to_text_or_date(column: str, value: Any, row_number: int, errors: list[RowError]) -> Any:
    if value in (None, ""):
        return ""
    if column == "joined_on":
        parsed = _parse_date(value)
        if parsed is None:
            errors.append(RowError(row_number, column, "DATE_INVALID", "Use DD/MM/YYYY."))
            return ""
        return parsed.isoformat()
    if column in ("hourly_rate", "ot_rate_per_hour"):
        try:
            return str(Decimal(str(value)).quantize(Decimal("0.01")))
        except InvalidOperation:
            errors.append(RowError(row_number, column, "NUMBER_INVALID", "Type a number."))
            return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))  # Excel stores 1043 as 1043.0
    return str(value)


def _parse_date(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    match = DATE_PATTERN.match(text)
    if match:
        day, month, year = (int(part) for part in match.groups())
        try:
            return date(year, month, day)
        except ValueError:
            return None
    try:
        return date.fromisoformat(text)  # a saved request stores ISO dates
    except ValueError:
        return None


def _resolve(
    row_number: int, row: dict[str, Any], lookups: _Lookups, errors: list[RowError]
) -> EmployeeValues | None:
    plant = lookups.plant(row["plant_code"])
    if plant is None:
        errors.append(
            RowError(row_number, "plant_code", "PLANT_NOT_FOUND", "No plant with this code.")
        )
        return None

    def find(model, column: str, code: str):  # noqa: ANN001, ANN202 (small local helper)
        if not row.get(column):
            return None
        found = lookups.in_plant(model, plant.id, row[column])
        if found is None:
            errors.append(RowError(row_number, column, code, f"Not found at plant {plant.code}."))
        return found

    category_id = find(EmployeeCategory, "category", "CATEGORY_NOT_IN_PLANT")
    shift_id = find(Shift, "shift", "SHIFT_NOT_IN_PLANT")
    department_id = find(Department, "department", "DEPARTMENT_NOT_IN_PLANT")
    contractor_id = None
    if row.get("contractor"):
        contractor_id = lookups.contractor(row["contractor"])
        if contractor_id is None:
            errors.append(
                RowError(
                    row_number,
                    "contractor",
                    "CONTRACTOR_NOT_FOUND",
                    "No contractor with this name.",
                )
            )
    if category_id is None or shift_id is None or (row.get("department") and department_id is None):
        return None
    if row.get("contractor") and contractor_id is None:
        return None

    employee_type = row["type"].lower()
    return EmployeeValues(
        employee_code=clean_code(row["employee_code"]),
        full_name=row["full_name"],
        type=employee_type,
        plant_id=plant.id,
        category_id=category_id,
        department_id=department_id,
        shift_id=shift_id,
        contractor_id=contractor_id,
        punch_method=(row.get("punch_method") or default_punch_method(employee_type)).lower(),
        hourly_rate=Decimal(row["hourly_rate"]) if row.get("hourly_rate") else None,
        ot_rate_per_hour=Decimal(row["ot_rate_per_hour"]) if row.get("ot_rate_per_hour") else None,
        joined_on=date.fromisoformat(row["joined_on"]),
    )


def _column_name(field_name: str) -> str:
    """Rule errors name model fields; show them as the file's columns."""
    return {"plant": "plant_code", "contractor": "contractor"}.get(field_name, field_name)
