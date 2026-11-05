"""Reads a downloaded file again and prints what is in it as JSON, for the end-to-end journeys only:

    APP_ENV=test uv run python -m app.scripts.e2e_read_file ../e2e/.tmp/register.xlsx

A journey (M6, e2e/journeys) downloads a report, an export or a card, then compares what the FILE
holds (not what the screen said) with the golden numbers. Supported files:

  .xlsx  {"kind": "xlsx", "sheets": [{"name", "rows": [[cell text, ...], ...]}]} (cells as text)
  .pdf   {"kind": "pdf", "pages": <number>, "text": [text of page 1, ...]}
  .zip   {"kind": "zip", "names": [...], "manifest": <manifest.json parsed, or null>,
          "csv_headers": {"<file>.csv": [column name, ...]}}

It refuses to run unless APP_ENV=test, and it only reads.
"""

import csv
import io
import json
import os
import sys
import zipfile
from pathlib import Path
from typing import Any

from openpyxl import load_workbook


def read_xlsx(path: Path) -> dict[str, Any]:
    workbook = load_workbook(path, read_only=True, data_only=True)
    sheets = []
    for worksheet in workbook.worksheets:
        rows = [
            ["" if cell is None else str(cell) for cell in row]
            for row in worksheet.iter_rows(values_only=True)
        ]
        sheets.append({"name": worksheet.title, "rows": rows})
    workbook.close()
    return {"kind": "xlsx", "sheets": sheets}


def read_pdf(path: Path) -> dict[str, Any]:
    import pypdfium2  # a test-only package: imported here so the other readers work without it

    document = pypdfium2.PdfDocument(path)
    texts = []
    for index in range(len(document)):
        text_page = document[index].get_textpage()
        texts.append(text_page.get_text_range())
    page_count = len(document)
    document.close()
    return {"kind": "pdf", "pages": page_count, "text": texts}


def read_zip(path: Path) -> dict[str, Any]:
    with zipfile.ZipFile(path) as archive:
        names = sorted(archive.namelist())
        manifest = None
        if "manifest.json" in names:
            manifest = json.loads(io.TextIOWrapper(archive.open("manifest.json"), "utf-8").read())
        # The first line of each CSV file: the column names, so a journey can prove that a
        # secret column (a sealed template, a password hash) is not in the export.
        csv_headers = {}
        for name in names:
            if name.endswith(".csv"):
                first_line = io.TextIOWrapper(archive.open(name), "utf-8-sig").readline()
                csv_headers[name] = next(csv.reader([first_line]), [])
    return {"kind": "zip", "names": names, "manifest": manifest, "csv_headers": csv_headers}


def read_file(path: Path) -> dict[str, Any]:
    suffix = path.suffix.lower()
    if suffix == ".xlsx":
        return read_xlsx(path)
    if suffix == ".pdf":
        return read_pdf(path)
    if suffix == ".zip":
        return read_zip(path)
    raise ValueError(f"Cannot read a {suffix or 'file without a type'} file.")


def main() -> None:
    if os.environ.get("APP_ENV") != "test":
        sys.exit("Refused: this tool runs only with APP_ENV=test.")
    if len(sys.argv) != 2:
        sys.exit("Usage: python -m app.scripts.e2e_read_file <file.xlsx|file.pdf|file.zip>")
    print(json.dumps(read_file(Path(sys.argv[1])), ensure_ascii=False))


if __name__ == "__main__":
    main()
