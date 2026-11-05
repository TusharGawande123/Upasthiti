"""The journey read-back tool (M6 AC-M6-7): reads xlsx, pdf and zip, refuses outside tests."""

import json
import zipfile
from pathlib import Path

import pytest
import xlsxwriter
from fpdf import FPDF

from app.scripts import e2e_read_file


def make_xlsx(path: Path) -> None:
    workbook = xlsxwriter.Workbook(str(path))
    sheet = workbook.add_worksheet("Register")
    sheet.write_string(0, 0, "Code")
    sheet.write_string(0, 1, "Name")
    sheet.write_string(1, 0, "E-1")
    sheet.write_number(1, 1, 7)
    workbook.close()


def test_reads_an_xlsx_file_cell_by_cell_as_text(tmp_path: Path) -> None:
    """M6 AC-M6-7: every cell comes back as text, in sheet order."""
    path = tmp_path / "register.xlsx"
    make_xlsx(path)

    result = e2e_read_file.read_file(path)

    assert result == {
        "kind": "xlsx",
        "sheets": [{"name": "Register", "rows": [["Code", "Name"], ["E-1", "7"]]}],
    }


def test_reads_a_zip_manifest(tmp_path: Path) -> None:
    """M6 AC-M6-7: a zip gives its file names and the parsed manifest."""
    path = tmp_path / "export.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("employees.csv", "code\n1\n")
        archive.writestr("manifest.json", json.dumps({"counts": {"employees": 1}}))

    result = e2e_read_file.read_file(path)

    assert result["names"] == ["employees.csv", "manifest.json"]
    assert result["manifest"] == {"counts": {"employees": 1}}


def test_reads_the_text_of_a_pdf_page(tmp_path: Path) -> None:
    """M6 AC-M6-7: a pdf gives its page count and the text of each page."""
    path = tmp_path / "card.pdf"
    document = FPDF()
    document.add_page()
    document.set_font("Helvetica", size=12)
    document.cell(text="Monthly register JRN1")
    document.output(str(path))

    result = e2e_read_file.read_file(path)

    assert result["pages"] == 1
    assert "Monthly register JRN1" in result["text"][0]


def test_an_unknown_file_type_is_refused(tmp_path: Path) -> None:
    """M6 AC-M6-7: only the three known types are read."""
    path = tmp_path / "notes.txt"
    path.write_text("hello")

    with pytest.raises(ValueError):
        e2e_read_file.read_file(path)


def test_the_tool_refuses_to_run_outside_the_test_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """M6 AC-M6-7: it is a test-only tool, like the other e2e_ scripts."""
    monkeypatch.setenv("APP_ENV", "production")

    with pytest.raises(SystemExit) as stopped:
        e2e_read_file.main()

    assert "Refused" in str(stopped.value)
