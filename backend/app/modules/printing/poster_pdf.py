"""The gate poster (F-34, spec M2 §7 rule 20, M3 §4.14): one A4 page per plant, put up next to the
attendance device.

It teaches changing workers how to punch without anyone explaining it (a card, or a face), and it
is the DPDP notice at the gate: why a photo is taken, how long it is kept, who can see it, where
the full privacy notice is. No personal data. Design: docs/design-refs/m3/gate-c/ (decision 0020).
Icons are Lucide SVGs (ISC, `icons/`) and one own drawing (`head-turn.svg`), drawn as vectors so
the poster prints sharp at any size.
"""

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import cast

from fpdf import FPDF

from app.modules.printing.cards_pdf import FONT_FOLDER, FONT_NAME

ICON_FOLDER = Path(__file__).resolve().parent / "icons"
PAGE_WIDTH_MM = 210.0
MARGIN_MM = 16.0
CONTENT_WIDTH_MM = PAGE_WIDTH_MM - 2 * MARGIN_MM
GAP_MM = 5.0
WAY_BOX_WIDTH_MM = (CONTENT_WIDTH_MM - GAP_MM) / 2
SIGNAL_YELLOW = (245, 183, 0)  # the safety yellow of the kiosk, decoration only
INK = (14, 23, 38)
MUTED = (61, 71, 87)
BUTTON_BLUE = (31, 58, 147)  # the blue "Punch with face" button of the gate screen
WHITE = (255, 255, 255)
WAYS_Y_MM = 43.0
WAYS_HEIGHT_MM = 62.0
SMALL_BOX_HEIGHT_MM = 27.0
BOTTOM_LIMIT_MM = 282.0  # the privacy box must end above the help line


def _icon(pdf: FPDF, name: str, x: float, y: float, size: float) -> None:
    pdf.image(str(ICON_FOLDER / f"{name}.svg"), x=x, y=y, w=size, h=size)


def _safety_stripe(pdf: FPDF, y: float) -> None:
    """Yellow and black diagonal stripes across the page: the kiosk's look, decoration only."""
    stripe = 10.0
    pdf.set_fill_color(*INK)
    pdf.rect(0, y, PAGE_WIDTH_MM, 6, style="F")
    pdf.set_fill_color(*SIGNAL_YELLOW)
    x = -stripe
    while x < PAGE_WIDTH_MM:
        pdf.polygon(
            [(x, y + 6), (x + stripe / 2, y), (x + stripe, y), (x + stripe / 2, y + 6)], style="F"
        )
        x += stripe


def _box(pdf: FPDF, x: float, y: float, width: float, height: float) -> None:
    pdf.set_draw_color(*INK)
    pdf.set_line_width(0.8)
    pdf.rect(x, y, width, height, style="D", round_corners=True, corner_radius=4)


def _text(
    pdf: FPDF,
    x: float,
    y: float,
    width: float,
    size: float,
    line: float,
    text: str,
    *,
    bold: bool = False,
    colour: tuple[int, int, int] = INK,
) -> float:
    """Writes wrapped text and returns the y below it."""
    pdf.set_xy(x, y)
    pdf.set_font(FONT_NAME, "B" if bold else "", size)
    pdf.set_text_color(*colour)
    pdf.multi_cell(width, line, text, align="L")
    return pdf.get_y()


def _text_height(pdf: FPDF, width: float, size: float, line: float, text: str, bold: bool) -> float:
    pdf.set_font(FONT_NAME, "B" if bold else "", size)
    lines = cast("list[str]", pdf.multi_cell(width, line, text, split_only=True))
    return len(lines) * line


def _card_box(pdf: FPDF, y: float, height: float) -> None:
    x = MARGIN_MM
    _box(pdf, x, y, WAY_BOX_WIDTH_MM, height)
    _icon(pdf, "id-card", x + 6, y + 6, 15)
    inner = WAY_BOX_WIDTH_MM - 12
    below = _text(
        pdf, x + 25, y + 5, inner - 19, 13.5, 6, "Card: hold your card to the camera", bold=True
    )
    below = _text(
        pdf,
        x + 6,
        max(below, y + 23) + 2,
        inner,
        12,
        5.2,
        "Hold it still, about 20 cm from the camera.",
        colour=MUTED,
    )
    _text(
        pdf,
        x + 6,
        below + 2,
        inner,
        12,
        5.2,
        "Then look at the camera: a photo is taken with every card punch.",
        colour=MUTED,
    )


def _face_box(pdf: FPDF, y: float, height: float) -> None:
    x = MARGIN_MM + WAY_BOX_WIDTH_MM + GAP_MM
    _box(pdf, x, y, WAY_BOX_WIDTH_MM, height)
    inner = WAY_BOX_WIDTH_MM - 12
    below = _text(
        pdf,
        x + 6,
        y + 5,
        inner,
        13.5,
        6,
        "Face: tap Punch with face, turn your head as the arrow shows",
        bold=True,
    )
    row_x = x + 6
    text_x = row_x + 24
    text_width = WAY_BOX_WIDTH_MM - 12 - 24
    row_y = below + 2

    # 1. The blue button, as on the gate screen.
    pdf.set_fill_color(*BUTTON_BLUE)
    pdf.rect(row_x, row_y, 22, 13, style="F", round_corners=True, corner_radius=2.5)
    pdf.set_font(FONT_NAME, "B", 8)
    pdf.set_text_color(*WHITE)
    pdf.set_xy(row_x, row_y + 2)
    pdf.multi_cell(22, 4.2, "Punch\nwith face", align="C")
    _text(pdf, text_x, row_y + 3, text_width, 11.5, 5, "Tap the blue button.")

    # 2. The head turn.
    row_y += 14
    _icon(pdf, "head-turn", row_x + 4, row_y - 1, 14)
    _text(
        pdf,
        text_x,
        row_y,
        text_width,
        11.5,
        5,
        "Turn your head as the arrow shows, then look straight.",
    )

    # 3. The employee code, if the screen asks for it.
    row_y += 15
    _box(pdf, row_x, row_y, 22, 11)
    pdf.set_font(FONT_NAME, "B", 12)
    pdf.set_text_color(*INK)
    pdf.set_xy(row_x, row_y + 2.5)
    pdf.cell(22, 6, "0123", align="C")
    _text(pdf, text_x, row_y, text_width, 11.5, 5, "If the screen asks, type your employee code.")


def _small_box(
    pdf: FPDF, column: int, icon: str, title: str, text: str, y: float, height: float
) -> None:
    """A half-width box with an icon, a bold title and one muted line (two boxes side by side)."""
    x = MARGIN_MM + column * (WAY_BOX_WIDTH_MM + GAP_MM)
    _box(pdf, x, y, WAY_BOX_WIDTH_MM, height)
    _icon(pdf, icon, x + 5, y + 5, 14)
    text_x = x + 24
    text_width = WAY_BOX_WIDTH_MM - 29
    below = _text(pdf, text_x, y + 4, text_width, 13, 5.6, title, bold=True)
    _text(pdf, text_x, below + 0.5, text_width, 11.5, 5, text, colour=MUTED)


# M4 (spec §4.2, §4.12, §8.1): what happens to a punch when the gate has no internet.
OFFLINE_NOTICE = (
    "No internet? Your punch is saved on this attendance device in a locked form that only our "
    "server can open, and it is deleted from the device once it is sent. It is checked later; "
    "if something is wrong, the plant office will tell you."
)
# The privacy text is a little smaller than the "how to punch" text so the M4 offline paragraph
# fits on the one A4 page; the face box above cannot get shorter.
PRIVACY_SIZE, PRIVACY_LINE = 11.0, 4.9
PARAGRAPH_AIR_MM = 1.5


def _privacy_paragraphs(retention_days: int) -> list[str]:
    notice = (
        "Face punch: your face is checked against an encrypted record. A photo is kept for "
        f"{retention_days} days only if the punch fails or you type your code. Card punch: a "
        f"photo is kept for {retention_days} days and checked automatically to see that a face "
        "is present."
    )
    rights = (
        "Only the Super Admin can open a photo, and every view is recorded. Face data is never "
        "shared and never sent to any AI company. Your punch times are kept as attendance "
        "records, as the law requires."
    )
    return [notice, rights, OFFLINE_NOTICE]


@dataclass(frozen=True)
class PosterShift:
    """One line of the "Your shift times" box (M5 spec §4.17): the rules in force today."""

    name: str
    start: time
    end: time
    grace_min: int


MAX_POSTER_SHIFTS = 6
SHIFT_SIZE = 14.0
SHIFT_LINE, SHIFT_LINE_COMPACT = 6.5, 5.3  # compact: more than three shifts


def _shift_line_height(shift_count: int) -> float:
    return SHIFT_LINE if shift_count <= 3 else SHIFT_LINE_COMPACT


SHIFT_RULES = (
    "One IN and one OUT per shift. After your OUT you cannot punch again in the same shift.",
    "Please visit the plant office if your shift is closed by mistake.",
)


def _clock(moment: time) -> str:
    return f"{moment:%H:%M}"


def _on_time_until(shift: PosterShift) -> time:
    """The start plus the grace (grace is only at the start, decision 0036 line 8)."""
    started = datetime.combine(date.today(), shift.start)
    return (started + timedelta(minutes=shift.grace_min)).time()


def shifts_box_height(pdf: FPDF, shift_count: int) -> float:
    """Header, one line per shown shift (and the "and N more" line) and the two rule lines."""
    lines = min(shift_count, MAX_POSTER_SHIFTS)  # the "and N more" line takes the sixth place
    rules = sum(
        _text_height(pdf, CONTENT_WIDTH_MM - 10, SHIFT_SIZE, 6, rule, True) for rule in SHIFT_RULES
    )
    return 11 + 2 + lines * _shift_line_height(shift_count) + 3 + rules + 1


def _shifts_box(pdf: FPDF, y: float, shifts: list[PosterShift], made_on: date) -> float:
    """The blue-headed box with one line per active shift. Returns the y below it."""
    height = shifts_box_height(pdf, len(shifts))
    pdf.set_fill_color(*BUTTON_BLUE)
    pdf.rect(MARGIN_MM, y, CONTENT_WIDTH_MM, 11, style="F", round_corners=True, corner_radius=4)
    pdf.rect(MARGIN_MM, y + 6, CONTENT_WIDTH_MM, 5, style="F")  # square the lower corners
    pdf.set_draw_color(*BUTTON_BLUE)
    pdf.set_line_width(0.8)
    pdf.rect(MARGIN_MM, y, CONTENT_WIDTH_MM, height, style="D", round_corners=True, corner_radius=4)
    _icon(pdf, "clock", MARGIN_MM + 5, y + 2, 7)
    pdf.set_text_color(*WHITE)
    pdf.set_font(FONT_NAME, "B", 16)
    pdf.set_xy(MARGIN_MM + 15, y + 2)
    pdf.cell(80, 7, "Your shift times")
    pdf.set_font(FONT_NAME, "B", 11)
    pdf.set_xy(MARGIN_MM + CONTENT_WIDTH_MM - 85, y + 2)
    pdf.cell(80, 7, f"Shift times as on {made_on:%d/%m/%Y}", align="R")

    row_y = y + 13
    name_width = 34.0
    # With more than six shifts, five are listed and the sixth line says how many are left out:
    # the page has room for six lines, never seven (decision 0036 line 19).
    shown = shifts if len(shifts) <= MAX_POSTER_SHIFTS else shifts[: MAX_POSTER_SHIFTS - 1]
    line = _shift_line_height(len(shifts))
    for shift in shown:
        _shift_line(pdf, row_y, shift, name_width, line)
        row_y += line
    if len(shifts) > MAX_POSTER_SHIFTS:
        more = len(shifts) - len(shown)
        plural = "shift" if more == 1 else "shifts"
        row_y = _text(
            pdf,
            MARGIN_MM + 5,
            row_y,
            CONTENT_WIDTH_MM - 10,
            SHIFT_SIZE,
            line,
            f"and {more} more {plural}: ask the plant office",
            colour=MUTED,
        )
    row_y += 2
    pdf.set_draw_color(*INK)
    pdf.set_line_width(0.3)
    pdf.line(MARGIN_MM + 5, row_y, MARGIN_MM + CONTENT_WIDTH_MM - 5, row_y)
    row_y += 2
    for rule in SHIFT_RULES:
        row_y = _text(
            pdf, MARGIN_MM + 5, row_y, CONTENT_WIDTH_MM - 10, SHIFT_SIZE, 6, rule, bold=True
        )
    return y + height


def _shift_line(pdf: FPDF, y: float, shift: PosterShift, name_width: float, line: float) -> None:
    """ "Office  09:00-17:00: on time until 09:30, leave from 17:00." with the key times bold."""
    pdf.set_text_color(*INK)
    pdf.set_font(FONT_NAME, "B", SHIFT_SIZE)
    name = shift.name
    while name and pdf.get_string_width(name) > name_width - 2:
        name = name[:-1]
    pdf.set_xy(MARGIN_MM + 5, y)
    pdf.cell(name_width, line, name if name == shift.name else name.rstrip() + "…")
    pieces = (
        (False, f"{_clock(shift.start)}–{_clock(shift.end)}: on time until "),
        (True, _clock(_on_time_until(shift))),
        (False, ", leave from "),
        (True, _clock(shift.end)),
        (False, "."),
    )
    for bold, text in pieces:
        pdf.set_font(FONT_NAME, "B" if bold else "", SHIFT_SIZE)
        pdf.cell(pdf.get_string_width(text) + 0.2, line, text)
    pdf.set_draw_color(205, 212, 224)
    pdf.set_line_width(0.2)
    pdf.line(MARGIN_MM + 5, y + line, MARGIN_MM + CONTENT_WIDTH_MM - 5, y + line)


PRIVACY_HEADING = "About your face and the photo"
PRIVACY_LEAD = "Pressing Punch with face means your face is checked."


def privacy_box_height(pdf: FPDF, retention_days: int) -> float:
    """The height the privacy box needs (a test checks it fits above the help line)."""
    text_width = CONTENT_WIDTH_MM - 36
    content = _text_height(pdf, text_width, 15, 7, PRIVACY_HEADING, True) + _text_height(
        pdf, text_width, 13, 5.5, PRIVACY_LEAD, True
    )
    for paragraph in _privacy_paragraphs(retention_days):
        content += PARAGRAPH_AIR_MM + _text_height(
            pdf, text_width, PRIVACY_SIZE, PRIVACY_LINE, paragraph, False
        )
    return content + 8


def _privacy_box(pdf: FPDF, y: float, retention_days: int) -> None:
    """The DPDP notice: what the punches keep, who sees it, and what happens offline. Where to
    read more is on the help line below the box."""
    text_x = MARGIN_MM + 30
    text_width = CONTENT_WIDTH_MM - 36
    height = min(privacy_box_height(pdf, retention_days), BOTTOM_LIMIT_MM - y)
    _box(pdf, MARGIN_MM, y, CONTENT_WIDTH_MM, height)
    _icon(pdf, "shield-check", MARGIN_MM + 6, y + 5, 18)
    below = _text(pdf, text_x, y + 4, text_width, 15, 7, PRIVACY_HEADING, bold=True)
    below = _text(pdf, text_x, below, text_width, 13, 5.5, PRIVACY_LEAD, bold=True)
    for paragraph in _privacy_paragraphs(retention_days):
        below = _text(
            pdf, text_x, below + PARAGRAPH_AIR_MM, text_width, PRIVACY_SIZE, PRIVACY_LINE, paragraph
        )


def _help_line(pdf: FPDF, privacy_address: str) -> None:
    """ "Need help? Ask the plant office." and the address of the full privacy notice, centred
    on one line above the bottom stripe."""
    help_text = "Need help? Ask the plant office."
    more = f"   Full privacy notice: {privacy_address}"
    pdf.set_text_color(*INK)
    for size in (12, 11, 10, 9):
        pdf.set_font(FONT_NAME, "B", size)
        help_width = pdf.get_string_width(help_text)
        pdf.set_font(FONT_NAME, "", size)
        total = help_width + pdf.get_string_width(more)
        if total <= CONTENT_WIDTH_MM or size == 9:
            break
    pdf.set_xy(MARGIN_MM + max(0.0, (CONTENT_WIDTH_MM - total) / 2), 284)
    pdf.set_font(FONT_NAME, "B", size)
    pdf.cell(help_width, 6, help_text)
    pdf.set_font(FONT_NAME, "", size)
    pdf.cell(0, 6, more)


def _plant_line(pdf: FPDF, text: str) -> None:
    """The plant under the title. Plant names can be long (120 letters): the font shrinks until
    the line fits; the longest names wrap onto a second line."""
    pdf.set_text_color(*MUTED)
    for size in (16, 14, 12):
        pdf.set_font(FONT_NAME, "", size)
        if pdf.get_string_width(text) <= CONTENT_WIDTH_MM:
            pdf.set_xy(MARGIN_MM, 26)
            pdf.cell(CONTENT_WIDTH_MM, 8, text)
            return
    pdf.set_font(FONT_NAME, "", 11)
    pdf.set_xy(MARGIN_MM, 25)
    pdf.multi_cell(CONTENT_WIDTH_MM, 5, text, align="L")


def gate_poster_pdf(
    plant_name: str,
    plant_code: str,
    retention_days: int,
    privacy_address: str,
    shifts: list[PosterShift],
    made_on: date,
) -> bytes:
    """`privacy_address` is printed as text (for example "example.app/privacy"), never as a QR
    code: next to the card codes at the gate it could be mistaken for one (decision 0020).
    `shifts` are the plant's active shifts with the rules in force on `made_on` (M5 spec §4.17)."""
    pdf = FPDF(format="A4", unit="mm")
    pdf.set_auto_page_break(False)
    pdf.add_font(FONT_NAME, "", str(FONT_FOLDER / "Inter-Regular.ttf"))
    pdf.add_font(FONT_NAME, "B", str(FONT_FOLDER / "Inter-Bold.ttf"))
    pdf.set_title(f"Gate poster - {plant_code}")
    pdf.add_page()

    _safety_stripe(pdf, 0)
    pdf.set_text_color(*INK)
    pdf.set_font(FONT_NAME, "B", 30)
    pdf.set_xy(MARGIN_MM, 12)
    pdf.cell(CONTENT_WIDTH_MM, 13, "Attendance at this gate")
    _plant_line(pdf, f"{plant_name} · {plant_code}")

    _text(pdf, MARGIN_MM, 36, CONTENT_WIDTH_MM, 16, 7, "Punch in one of two ways", bold=True)
    _card_box(pdf, WAYS_Y_MM, WAYS_HEIGHT_MM)
    _face_box(pdf, WAYS_Y_MM, WAYS_HEIGHT_MM)
    small_height = SMALL_BOX_HEIGHT_MM
    small_y = WAYS_Y_MM + WAYS_HEIGHT_MM + 3
    _small_box(
        pdf,
        0,
        "log-in",
        "See IN or OUT on the screen",
        "Your name and the time are shown. That is all.",
        small_y,
        small_height,
    )
    _small_box(
        pdf,
        1,
        "octagon-x",
        "NOT ACCEPTED? Go to the plant office.",
        "Do not try again and again. The office can see why.",
        small_y,
        small_height,
    )
    below = small_y + small_height + 3
    below = _shifts_box(pdf, below, shifts, made_on)
    _privacy_box(pdf, below + 3, retention_days)
    _help_line(pdf, privacy_address)
    _safety_stripe(pdf, 291)
    return bytes(pdf.output())
