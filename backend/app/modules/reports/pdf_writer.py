"""Writes a `Report` as a PDF (M5 spec §7 rule 18): A4, the bundled Inter font (OFL licence), the
company, title, plant, period, generated at and by on every page, and "Page x of y" at the foot.
At most 3,000 rows (`REPORT_TOO_LARGE`; Excel has no such limit). The column widths of the sheet
are scaled to fit the page; a long text is cut with an ellipsis rather than overflowing."""

from pathlib import Path

from fpdf import FPDF

from app.core.errors import ApiError
from app.core.time import to_ist
from app.modules.reports.model import DATE, MINUTES, Column, Report, Sheet
from app.modules.reports.xlsx_writer import hhmm

FONT_FOLDER = Path(__file__).resolve().parents[1] / "printing" / "fonts"
FONT_NAME = "Inter"
MAX_PDF_ROWS = 3000
MARGIN = 10.0
ROW_HEIGHT = 5.0


class _ReportPdf(FPDF):
    def __init__(self, report: Report) -> None:
        super().__init__(orientation="L" if report.landscape else "P", unit="mm", format="A4")
        self.report = report
        self.add_font(FONT_NAME, "", str(FONT_FOLDER / "Inter-Regular.ttf"))
        self.add_font(FONT_NAME, "B", str(FONT_FOLDER / "Inter-Bold.ttf"))
        self.set_margins(MARGIN, MARGIN + 22, MARGIN)
        self.set_auto_page_break(auto=True, margin=14)
        self.alias_nb_pages()
        self.plant_line = report.plant_text

    def header(self) -> None:
        report = self.report
        self.set_xy(MARGIN, 8)
        self.set_font(FONT_NAME, "B", 11)
        self.cell(
            0, 5, "Sheet Shapers – Upasthiti · " + report.title, new_x="LMARGIN", new_y="NEXT"
        )
        self.set_font(FONT_NAME, "", 8)
        generated = f"{to_ist(report.generated_at):%d/%m/%Y %H:%M} IST"
        self.cell(
            0,
            4,
            f"Plant: {self.plant_line} · Period: {report.period_text} · Generated {generated} "
            f"by {report.generated_by}",
            new_x="LMARGIN",
            new_y="NEXT",
        )
        extra = [report.filters] if report.filters else []
        if report.demo_included:
            extra.append("Demo plants included")
        if extra:
            self.cell(0, 4, " · ".join(extra), new_x="LMARGIN", new_y="NEXT")
        self.ln(2)

    def footer(self) -> None:
        self.set_y(-10)
        self.set_font(FONT_NAME, "", 8)
        self.cell(0, 5, f"Page {self.page_no()} of {{nb}}", align="C")


def build_pdf(report: Report) -> bytes:
    if report.row_count > MAX_PDF_ROWS:
        raise ApiError(
            "REPORT_TOO_LARGE",
            "This report is too big for a PDF. Choose one plant, or use Excel.",
            413,
            {"rows": report.row_count, "max_rows": MAX_PDF_ROWS},
        )
    pdf = _ReportPdf(report)
    for sheet in report.sheets:
        # Each plant starts on its own page, with its own name in the page header.
        pdf.plant_line = sheet.heading or report.plant_text
        pdf.add_page()
        _sheet(pdf, sheet)
    if report.legend:
        pdf.ln(2)
        pdf.set_font(FONT_NAME, "", 7)
        for line in report.legend:
            pdf.cell(0, 4, line, new_x="LMARGIN", new_y="NEXT")
    return bytes(pdf.output())


def _widths(pdf: FPDF, columns: list[Column]) -> list[float]:
    available = pdf.w - 2 * MARGIN
    total = sum(column.width for column in columns)
    return [available * column.width / total for column in columns]


def _cell_text(column: Column, value: object) -> str:
    if value is None or value == "":
        return ""
    if column.kind == MINUTES and isinstance(value, int):
        return hhmm(value)
    if column.kind == DATE and hasattr(value, "strftime"):
        return value.strftime("%d/%m/%Y")  # type: ignore[union-attr]
    return str(value)


def _fit(pdf: FPDF, text: str, width: float) -> str:
    if pdf.get_string_width(text) <= width - 1:
        return text
    while text and pdf.get_string_width(text + "…") > width - 1:
        text = text[:-1]
    return text + "…"


def _sheet(pdf: _ReportPdf, sheet: Sheet) -> None:
    size = 6.5 if len(sheet.columns) > 16 else 8
    widths = _widths(pdf, sheet.columns)
    _head_row(pdf, sheet.columns, widths, size)
    for index, row in enumerate(sheet.rows):
        if pdf.get_y() + ROW_HEIGHT > pdf.h - 14:
            pdf.add_page()
            _head_row(pdf, sheet.columns, widths, size)
        pdf.set_font(FONT_NAME, "B" if index in sheet.bold_rows else "", size)
        for column, width, value in zip(sheet.columns, widths, row, strict=False):
            pdf.cell(width, ROW_HEIGHT, _fit(pdf, _cell_text(column, value), width), border=1)
        pdf.ln()
    if not sheet.rows:
        pdf.set_font(FONT_NAME, "", 9)
        pdf.cell(0, 7, "No rows for this period.", new_x="LMARGIN", new_y="NEXT")


def _head_row(pdf: FPDF, columns: list[Column], widths: list[float], size: float) -> None:
    pdf.set_font(FONT_NAME, "B", size)
    pdf.set_fill_color(232, 236, 244)
    for column, width in zip(columns, widths, strict=True):
        pdf.cell(width, ROW_HEIGHT + 1, _fit(pdf, column.header, width), border=1, fill=True)
    pdf.ln()
