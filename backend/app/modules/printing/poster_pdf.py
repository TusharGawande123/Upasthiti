"""The gate poster (F-34, spec M2 §7 rule 20, M3 §4.14): one A4 page per plant, put up next to the
attendance device.

It teaches changing workers how to punch without anyone explaining it (a card, or a face), and it
is the DPDP notice at the gate: why a photo is taken, how long it is kept, who can see it, where
the full privacy notice is. No personal data. Design: docs/design-refs/m3/gate-c/ (decision 0020).
Icons are Lucide SVGs (ISC, `icons/`) and one own drawing (`head-turn.svg`), drawn as vectors so
the poster prints sharp at any size.
"""

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
    _icon(pdf, "id-card", x + 6, y + 6, 18)
    inner = WAY_BOX_WIDTH_MM - 12
    below = _text(
        pdf, x + 6, y + 28, inner, 17, 7.5, "Card: hold your card to the camera", bold=True
    )
    below = _text(
        pdf,
        x + 6,
        below + 3,
        inner,
        13,
        6,
        "Hold it still, about 20 cm from the camera.",
        colour=MUTED,
    )
    _text(
        pdf,
        x + 6,
        below + 3,
        inner,
        13,
        6,
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
        y + 6,
        inner,
        17,
        7.5,
        "Face: tap Punch with face, turn your head as the arrow shows",
        bold=True,
    )
    row_x = x + 6
    text_x = row_x + 24
    text_width = WAY_BOX_WIDTH_MM - 12 - 24
    row_y = below + 3

    # 1. The blue button, as on the gate screen.
    pdf.set_fill_color(*BUTTON_BLUE)
    pdf.rect(row_x, row_y, 22, 14, style="F", round_corners=True, corner_radius=2.5)
    pdf.set_font(FONT_NAME, "B", 8)
    pdf.set_text_color(*WHITE)
    pdf.set_xy(row_x, row_y + 2.5)
    pdf.multi_cell(22, 4.2, "Punch\nwith face", align="C")
    _text(pdf, text_x, row_y + 3, text_width, 12.5, 5.6, "Tap the blue button.")

    # 2. The head turn.
    row_y += 19
    _icon(pdf, "head-turn", row_x + 1, row_y - 2, 20)
    _text(
        pdf,
        text_x,
        row_y - 2,
        text_width,
        12.5,
        5.6,
        "Turn your head as the arrow shows, then look straight.",
    )

    # 3. The employee code, if the screen asks for it.
    row_y += 20
    _box(pdf, row_x, row_y, 22, 12)
    pdf.set_font(FONT_NAME, "B", 12)
    pdf.set_text_color(*INK)
    pdf.set_xy(row_x, row_y + 3)
    pdf.cell(22, 6, "0123", align="C")
    _text(pdf, text_x, row_y, text_width, 12.5, 5.6, "If the screen asks, type your employee code.")


def _result_box(pdf: FPDF, y: float) -> float:
    """ "See IN or OUT on the screen", one box under the two ways. Returns the y below it."""
    height = 22.0
    _box(pdf, MARGIN_MM, y, CONTENT_WIDTH_MM, height)
    _icon(pdf, "log-in", MARGIN_MM + 6, y + 3, 16)
    text_x = MARGIN_MM + 30
    text_width = CONTENT_WIDTH_MM - 36
    below = _text(
        pdf, text_x, y + 3.5, text_width, 19, 8.5, "See IN or OUT on the screen", bold=True
    )
    _text(
        pdf,
        text_x,
        below + 0.5,
        text_width,
        13,
        6,
        "Your name and the time are shown. That is all.",
        colour=MUTED,
    )
    return y + height


def _boxed_note(pdf: FPDF, icon: str, title: str, text: str, y: float, height: float) -> float:
    _box(pdf, MARGIN_MM, y, CONTENT_WIDTH_MM, height)
    _icon(pdf, icon, MARGIN_MM + 6, y + 4, 16)
    text_x = MARGIN_MM + 32
    text_width = CONTENT_WIDTH_MM - 38
    below = _text(pdf, text_x, y + 4, text_width, 16, 7.5, title, bold=True)
    _text(pdf, text_x, below, text_width, 12, 6, text)
    return y + height


# M4 (spec §4.2, §4.12, §8.1): what happens to a punch when the gate has no internet.
OFFLINE_NOTICE = (
    "No internet? Your punch is saved on this attendance device in a locked form that only our "
    "server can open, and it is deleted from the device once it is sent. It is checked later; "
    "if something is wrong, the plant office will tell you."
)
# The privacy text is a little smaller than the "how to punch" text so the M4 offline paragraph
# fits on the one A4 page; the face box above cannot get shorter.
PRIVACY_SIZE, PRIVACY_LINE = 11.0, 4.9
PARAGRAPH_AIR_MM = 2.0


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


PRIVACY_HEADING = "About your face and the photo"
PRIVACY_LEAD = "Pressing Punch with face means your face is checked."


def privacy_box_height(pdf: FPDF, retention_days: int) -> float:
    """The height the privacy box needs (a test checks it fits above the help line)."""
    text_width = CONTENT_WIDTH_MM - 36
    content = _text_height(pdf, text_width, 16, 7.5, PRIVACY_HEADING, True) + _text_height(
        pdf, text_width, 13.5, 6, PRIVACY_LEAD, True
    )
    for paragraph in _privacy_paragraphs(retention_days):
        content += PARAGRAPH_AIR_MM + _text_height(
            pdf, text_width, PRIVACY_SIZE, PRIVACY_LINE, paragraph, False
        )
    return content + 12


def _privacy_box(pdf: FPDF, y: float, retention_days: int) -> None:
    """The DPDP notice: what the punches keep, who sees it, and what happens offline. Where to
    read more is on the help line below the box."""
    text_x = MARGIN_MM + 30
    text_width = CONTENT_WIDTH_MM - 36
    height = min(privacy_box_height(pdf, retention_days), BOTTOM_LIMIT_MM - y)
    _box(pdf, MARGIN_MM, y, CONTENT_WIDTH_MM, height)
    _icon(pdf, "shield-check", MARGIN_MM + 6, y + 6, 18)
    below = _text(pdf, text_x, y + 6, text_width, 16, 7.5, PRIVACY_HEADING, bold=True)
    below = _text(pdf, text_x, below, text_width, 13.5, 6, PRIVACY_LEAD, bold=True)
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
            pdf.set_xy(MARGIN_MM, 31)
            pdf.cell(CONTENT_WIDTH_MM, 8, text)
            return
    pdf.set_font(FONT_NAME, "", 11)
    pdf.set_xy(MARGIN_MM, 30)
    pdf.multi_cell(CONTENT_WIDTH_MM, 5, text, align="L")


def gate_poster_pdf(
    plant_name: str, plant_code: str, retention_days: int, privacy_address: str
) -> bytes:
    """`privacy_address` is printed as text (for example "example.app/privacy"), never as a QR
    code: next to the card codes at the gate it could be mistaken for one (decision 0020)."""
    pdf = FPDF(format="A4", unit="mm")
    pdf.set_auto_page_break(False)
    pdf.add_font(FONT_NAME, "", str(FONT_FOLDER / "Inter-Regular.ttf"))
    pdf.add_font(FONT_NAME, "B", str(FONT_FOLDER / "Inter-Bold.ttf"))
    pdf.set_title(f"Gate poster - {plant_code}")
    pdf.add_page()

    _safety_stripe(pdf, 0)
    pdf.set_text_color(*INK)
    pdf.set_font(FONT_NAME, "B", 30)
    pdf.set_xy(MARGIN_MM, 16)
    pdf.cell(CONTENT_WIDTH_MM, 13, "Attendance at this gate")
    _plant_line(pdf, f"{plant_name} · {plant_code}")

    _text(pdf, MARGIN_MM, 42, CONTENT_WIDTH_MM, 16, 7, "Punch in one of two ways", bold=True)
    ways_height = 90.0
    _card_box(pdf, 51, ways_height)
    _face_box(pdf, 51, ways_height)
    below = _result_box(pdf, 51 + ways_height + 4)
    below = _boxed_note(
        pdf,
        "octagon-x",
        "If it says NOT ACCEPTED, go to the plant office.",
        "Do not try again and again. The office can see why and will help you.",
        y=below + 4,
        height=24,
    )
    _privacy_box(pdf, below + 4, retention_days)
    _help_line(pdf, privacy_address)
    _safety_stripe(pdf, 291)
    return bytes(pdf.output())
