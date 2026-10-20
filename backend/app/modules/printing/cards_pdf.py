"""Draws ID cards as PDF (spec §4.9): one CR80 card (85.6 x 54 mm) per page, or A4 sheets of
ten cards (2 x 5) with cut lines. Pure drawing: no database, no settings.

The QR code is drawn as vector squares (never as a picture), so it stays sharp at any print
size. Error correction level Q recovers up to a quarter of a scratched card. The end date is
deliberately not printed: the Super Admin can extend or end a card without reprinting it.
"""

from dataclasses import dataclass
from datetime import date
from pathlib import Path

import segno
from fpdf import FPDF

FONT_FOLDER = Path(__file__).resolve().parent / "fonts"
FONT_NAME = "Inter"

CARD_WIDTH_MM = 85.6  # CR80, the size of a bank card
CARD_HEIGHT_MM = 54.0
A4_WIDTH_MM = 210.0
A4_HEIGHT_MM = 297.0
SHEET_COLUMNS = 2
SHEET_ROWS = 5
CARDS_PER_SHEET = SHEET_COLUMNS * SHEET_ROWS
CUT_MARK_EXTRA_MM = 3.0  # cut lines stick out past the cards so they are easy to follow

QR_SYMBOL_MM = 29.0  # the dark part of the code, without its white border
QR_QUIET_MODULES = 4  # the white border every QR code needs, counted in modules
LEFT_TEXT_X = 4.0
LEFT_TEXT_WIDTH = 43.0
NAME_FONT_SIZES = (13, 12, 11, 10, 9, 8)  # the name shrinks until it fits two lines


@dataclass(frozen=True)
class CardFace:
    """Everything printed on one card. A test card has no employee and no plant."""

    serial: str
    qr_text: str  # the full payload UPS1.<key>.<serial>.<signature>
    issued_on: date
    is_test: bool = False
    # Employee cards
    employee_name: str = ""
    employee_code: str = ""
    contractor_name: str | None = None
    plant_name: str = ""
    plant_code: str = ""
    # Test cards
    label: str = ""


def single_cards_pdf(faces: list[CardFace]) -> bytes:
    """One page the size of the card itself for every card (for a card printer)."""
    pdf = _new_pdf()
    for face in faces:
        pdf.add_page(format=(CARD_WIDTH_MM, CARD_HEIGHT_MM))
        _draw_card(pdf, face, 0.0, 0.0)
    return bytes(pdf.output())


def a4_sheets_pdf(faces: list[CardFace]) -> bytes:
    """Ten cards per A4 page, in the given order, with cut lines. 12 cards = 2 pages."""
    pdf = _new_pdf()
    left = (A4_WIDTH_MM - SHEET_COLUMNS * CARD_WIDTH_MM) / 2
    top = (A4_HEIGHT_MM - SHEET_ROWS * CARD_HEIGHT_MM) / 2
    for start in range(0, len(faces), CARDS_PER_SHEET):
        pdf.add_page(format=(A4_WIDTH_MM, A4_HEIGHT_MM))
        _draw_cut_lines(pdf, left, top)
        for position, face in enumerate(faces[start : start + CARDS_PER_SHEET]):
            row, column = divmod(position, SHEET_COLUMNS)
            _draw_card(pdf, face, left + column * CARD_WIDTH_MM, top + row * CARD_HEIGHT_MM)
    return bytes(pdf.output())


def qr_symbol(qr_text: str) -> segno.QRCode:
    """The QR code of a card (level Q). `.version` is the size class: S-23 keeps it at 7 or less."""
    return segno.make(qr_text, error="q", boost_error=False)


# --- Page setup -------------------------------------------------------------------------------


def _new_pdf() -> FPDF:
    pdf = FPDF(unit="mm")
    pdf.set_auto_page_break(auto=False)
    pdf.set_margins(0, 0, 0)
    # Bundled TrueType fonts, so any name prints correctly on any computer (OFL licence).
    pdf.add_font(FONT_NAME, "", str(FONT_FOLDER / "Inter-Regular.ttf"))
    pdf.add_font(FONT_NAME, "B", str(FONT_FOLDER / "Inter-Bold.ttf"))
    pdf.set_title("Upasthiti ID cards")  # no names in the file's properties
    pdf.set_creator("Upasthiti")
    return pdf


def _draw_cut_lines(pdf: FPDF, left: float, top: float) -> None:
    pdf.set_draw_color(150, 150, 150)
    pdf.set_line_width(0.1)
    right = left + SHEET_COLUMNS * CARD_WIDTH_MM
    bottom = top + SHEET_ROWS * CARD_HEIGHT_MM
    for column in range(SHEET_COLUMNS + 1):
        x = left + column * CARD_WIDTH_MM
        pdf.line(x, top - CUT_MARK_EXTRA_MM, x, bottom + CUT_MARK_EXTRA_MM)
    for row in range(SHEET_ROWS + 1):
        y = top + row * CARD_HEIGHT_MM
        pdf.line(left - CUT_MARK_EXTRA_MM, y, right + CUT_MARK_EXTRA_MM, y)


# --- One card ---------------------------------------------------------------------------------


def _draw_card(pdf: FPDF, face: CardFace, x: float, y: float) -> None:
    pdf.set_draw_color(0, 0, 0)
    pdf.set_text_color(0, 0, 0)
    pdf.set_line_width(0.2)
    pdf.rect(
        x + 0.3,
        y + 0.3,
        CARD_WIDTH_MM - 0.6,
        CARD_HEIGHT_MM - 0.6,
        round_corners=True,
        corner_radius=2.5,
    )

    _draw_header(pdf, face, x, y)
    if face.is_test:
        _draw_test_text(pdf, face, x, y)
    else:
        _draw_employee_text(pdf, face, x, y)
    _draw_qr(pdf, face.qr_text, x, y)

    pdf.set_font(FONT_NAME, "", 5.5)
    pdf.text(
        x + LEFT_TEXT_X,
        y + 51.2,
        "A photo is taken at each punch. If found, return to the plant office.",
    )


def _draw_header(pdf: FPDF, face: CardFace, x: float, y: float) -> None:
    pdf.set_font(FONT_NAME, "B", 9)
    pdf.text(x + LEFT_TEXT_X, y + 5.6, "Sheet Shapers")
    pdf.set_font(FONT_NAME, "", 6.5)
    subtitle = "Gate test card" if face.is_test else f"{face.plant_name} · {face.plant_code}"
    pdf.text(x + LEFT_TEXT_X, y + 9.2, _shorten(pdf, subtitle, CARD_WIDTH_MM - 2 * LEFT_TEXT_X))
    pdf.set_line_width(0.15)
    pdf.line(x + LEFT_TEXT_X, y + 11.0, x + CARD_WIDTH_MM - LEFT_TEXT_X, y + 11.0)


def _draw_employee_text(pdf: FPDF, face: CardFace, x: float, y: float) -> None:
    name_bottom = _draw_name(pdf, face.employee_name, x + LEFT_TEXT_X, y + 13.0)

    pdf.set_font(FONT_NAME, "B", 17)
    pdf.text(x + LEFT_TEXT_X, max(name_bottom + 8.0, y + 30.5), face.employee_code)

    pdf.set_font(FONT_NAME, "", 6.5)
    if face.contractor_name:
        pdf.text(
            x + LEFT_TEXT_X,
            y + 35.5,
            _shorten(pdf, f"Contractor: {face.contractor_name}", LEFT_TEXT_WIDTH),
        )
    pdf.text(x + LEFT_TEXT_X, y + 39.5, f"Issued {face.issued_on:%d/%m/%Y}")
    pdf.set_font(FONT_NAME, "B", 8)
    pdf.text(x + LEFT_TEXT_X, y + 44.5, f"Card {face.serial}")


def _draw_test_text(pdf: FPDF, face: CardFace, x: float, y: float) -> None:
    # A black band, so nobody mistakes a test card for an ID card.
    pdf.set_fill_color(0, 0, 0)
    pdf.rect(x + LEFT_TEXT_X, y + 13.0, LEFT_TEXT_WIDTH, 8.0, style="F")
    pdf.set_text_color(255, 255, 255)
    pdf.set_font(FONT_NAME, "B", 7.2)
    pdf.text(x + LEFT_TEXT_X + 1.6, y + 18.3, "TEST – NOT AN ID CARD")
    pdf.set_text_color(0, 0, 0)

    _draw_name(pdf, face.label, x + LEFT_TEXT_X, y + 24.0)
    pdf.set_font(FONT_NAME, "", 6.5)
    pdf.text(x + LEFT_TEXT_X, y + 39.5, f"Issued {face.issued_on:%d/%m/%Y}")
    pdf.set_font(FONT_NAME, "B", 8)
    pdf.text(x + LEFT_TEXT_X, y + 44.5, f"Card {face.serial}")


def _draw_name(pdf: FPDF, name: str, x: float, y_top: float) -> float:
    """Print the name on at most two lines, shrinking the letters until it fits.

    Returns the y position of the bottom of the last line.
    """
    for size in NAME_FONT_SIZES:
        pdf.set_font(FONT_NAME, "B", size)
        lines = _wrap(pdf, name, LEFT_TEXT_WIDTH)
        # A single word wider than the text area counts as "does not fit" too.
        if len(lines) <= 2 and all(pdf.get_string_width(line) <= LEFT_TEXT_WIDTH for line in lines):
            return _print_lines(pdf, lines, size, x, y_top)

    # Even the smallest size does not fit: keep two lines and cut each with "…".
    size = NAME_FONT_SIZES[-1]
    pdf.set_font(FONT_NAME, "B", size)
    lines = _wrap(pdf, name, LEFT_TEXT_WIDTH)
    if len(lines) > 2:
        lines = [lines[0], " ".join(lines[1:])]
    lines = [_shorten(pdf, line, LEFT_TEXT_WIDTH) for line in lines]
    return _print_lines(pdf, lines, size, x, y_top)


def _print_lines(pdf: FPDF, lines: list[str], size: float, x: float, y_top: float) -> float:
    line_height = size * 0.3528 * 1.25  # points to millimetres, plus some air
    baseline = y_top
    for line in lines:
        baseline += line_height
        pdf.text(x, baseline, line)
    return baseline


def _wrap(pdf: FPDF, text: str, max_width: float) -> list[str]:
    """Break text into lines at spaces; a single word that is too wide gets a line of its own."""
    lines: list[str] = []
    current = ""
    for word in text.split():
        candidate = f"{current} {word}".strip()
        if current and pdf.get_string_width(candidate) > max_width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines or [""]


def _shorten(pdf: FPDF, text: str, max_width: float) -> str:
    """Cut text with "…" so it is not wider than max_width (in the current font)."""
    if pdf.get_string_width(text) <= max_width:
        return text
    while text and pdf.get_string_width(text + "…") > max_width:
        text = text[:-1]
    return text.rstrip() + "…"


# --- The QR code ------------------------------------------------------------------------------


def _draw_qr(pdf: FPDF, qr_text: str, x: float, y: float) -> None:
    matrix = qr_symbol(qr_text).matrix
    modules = len(matrix)
    module_mm = QR_SYMBOL_MM / modules
    quiet_mm = QR_QUIET_MODULES * module_mm
    # The white border sits inside the card, to the right of the text.
    left = x + CARD_WIDTH_MM - 3.0 - QR_SYMBOL_MM - quiet_mm
    top = y + 12.0 + quiet_mm / 2

    pdf.set_fill_color(0, 0, 0)
    for row_index, row in enumerate(matrix):
        # One rectangle per run of dark modules keeps the PDF small.
        run_start: int | None = None
        for column_index in range(modules + 1):
            dark = column_index < modules and bool(row[column_index])
            if dark and run_start is None:
                run_start = column_index
            elif not dark and run_start is not None:
                pdf.rect(
                    left + run_start * module_mm,
                    top + row_index * module_mm,
                    (column_index - run_start) * module_mm,
                    module_mm + 0.01,  # a hair of overlap: no thin white lines between rows
                    style="F",
                )
                run_start = None
