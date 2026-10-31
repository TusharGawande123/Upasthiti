"""What a report looks like before it is written to Excel or PDF (M5 spec §7 rule 18).

Every report is a list of sheets (one per plant, plus a summary for "all plants"); a sheet is a
header row of columns and plain rows of values. The Excel and PDF writers know nothing about
attendance: they only draw this structure. Keeping the data and the drawing apart means the two
files always agree and a new report only needs rows.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

# A column holds one kind of value:
#   text     any string; always written as TEXT (never a formula, even if it starts with "=")
#   int      a whole number
#   date     a date (Excel gets a real date)
#   minutes  a number of minutes: Excel gets the number AND an "HH:MM" text column, the PDF "H:MM"
TEXT, INT, DATE, MINUTES = "text", "int", "date", "minutes"


@dataclass
class Column:
    header: str
    kind: str = TEXT
    width: int = 14  # Excel characters; the PDF scales the widths of a page to fit


@dataclass
class Sheet:
    name: str  # the Excel tab (a plant code, "Summary")
    columns: list[Column]
    rows: list[list[Any]] = field(default_factory=list)
    # Row numbers (0-based) drawn in bold: subtotals and section headings.
    bold_rows: set[int] = field(default_factory=set)
    # A line printed under the heading of the sheet, e.g. the plant name or "Notes".
    heading: str = ""


@dataclass
class Report:
    kind: str
    title: str
    plant_text: str  # "K134 · Sheet Shapers K-134" or "All plants"
    period_text: str  # "October 2026", "29/10/2026", "01/10/2026 to 31/10/2026"
    generated_at: datetime  # timezone-aware
    generated_by: str  # "Asha Rao (Super Admin)"
    sheets: list[Sheet]
    landscape: bool = False
    demo_included: bool = False
    filters: str = ""  # plain words, e.g. "Contractor: Shree Manpower"
    legend: list[str] = field(default_factory=list)

    @property
    def row_count(self) -> int:
        return sum(len(sheet.rows) for sheet in self.sheets)
