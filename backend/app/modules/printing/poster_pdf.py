"""The gate poster (F-34, spec M2 §7 rule 20): one A4 page per plant, put up next to the kiosk.

It teaches changing workers how to punch without anyone explaining it, and it is the DPDP notice
at the gate: why a photo is taken, how long it is kept, who can see it. No personal data.
Icons are Lucide SVGs (ISC, `icons/`), drawn as vectors so the poster prints sharp at any size.
"""

from pathlib import Path

from fpdf import FPDF

from app.modules.printing.cards_pdf import FONT_FOLDER, FONT_NAME

ICON_FOLDER = Path(__file__).resolve().parent / "icons"
PAGE_WIDTH_MM = 210.0
MARGIN_MM = 16.0
CONTENT_WIDTH_MM = PAGE_WIDTH_MM - 2 * MARGIN_MM
SIGNAL_YELLOW = (245, 183, 0)  # the safety yellow of the kiosk, decoration only
INK = (14, 23, 38)
MUTED = (61, 71, 87)
STEP_ICON_MM = 30.0

STEPS = (
    ("id-card", "Show your ID card to the camera", "Hold it still, about 20 cm from the camera."),
    ("scan-face", "Look at the camera", "A photo is taken with every card punch."),
    ("log-in", "See IN or OUT on the screen", "Your name and the time are shown. That is all."),
)


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


def _step(pdf: FPDF, number: int, icon: str, title: str, note: str, y: float) -> None:
    pdf.set_draw_color(*INK)
    pdf.set_line_width(0.8)
    pdf.rect(MARGIN_MM, y, CONTENT_WIDTH_MM, 42, style="D", round_corners=True, corner_radius=4)
    # The step number in a yellow circle, with an ink outline (never yellow text).
    pdf.set_fill_color(*SIGNAL_YELLOW)
    pdf.circle(x=MARGIN_MM + 11, y=y + 21, radius=7, style="FD")
    pdf.set_font(FONT_NAME, "B", 20)
    pdf.set_text_color(*INK)
    pdf.set_xy(MARGIN_MM + 4, y + 16)
    pdf.cell(14, 10, str(number), align="C")
    _icon(pdf, icon, MARGIN_MM + 24, y + 6, STEP_ICON_MM)
    text_x = MARGIN_MM + 24 + STEP_ICON_MM + 8
    text_width = CONTENT_WIDTH_MM - (text_x - MARGIN_MM) - 6
    pdf.set_xy(text_x, y + 9)
    pdf.set_font(FONT_NAME, "B", 20)
    pdf.multi_cell(text_width, 9, title, align="L")
    pdf.set_xy(text_x, pdf.get_y() + 1)
    pdf.set_font(FONT_NAME, "", 13)
    pdf.set_text_color(*MUTED)
    pdf.multi_cell(text_width, 6.5, note, align="L")


def _boxed_note(pdf: FPDF, icon: str, title: str, text: str, y: float, height: float) -> None:
    pdf.set_draw_color(*INK)
    pdf.set_line_width(0.8)
    pdf.rect(MARGIN_MM, y, CONTENT_WIDTH_MM, height, style="D", round_corners=True, corner_radius=4)
    _icon(pdf, icon, MARGIN_MM + 6, y + 6, 20)
    text_x = MARGIN_MM + 32
    text_width = CONTENT_WIDTH_MM - 38
    pdf.set_xy(text_x, y + 6)
    pdf.set_text_color(*INK)
    pdf.set_font(FONT_NAME, "B", 16)
    pdf.multi_cell(text_width, 7.5, title, align="L")
    pdf.set_x(text_x)
    pdf.set_font(FONT_NAME, "", 12)
    pdf.multi_cell(text_width, 6, text, align="L")


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


def gate_poster_pdf(plant_name: str, plant_code: str, retention_days: int) -> bytes:
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

    for index, (icon, title, note) in enumerate(STEPS):
        _step(pdf, index + 1, icon, title, note, 48 + index * 50)

    _boxed_note(
        pdf,
        "octagon-x",
        "If it says NOT ACCEPTED, go to the plant office.",
        "Do not try again and again. The office can see why and will help you.",
        y=200,
        height=32,
    )
    _boxed_note(
        pdf,
        "shield-check",
        "About the photo",
        (
            "A photo is taken at each card punch, only to stop card sharing. "
            f"It is kept for {retention_days} days and then deleted. Only the Super Admin can "
            "open it, and every view is recorded. It is never used for face recognition and "
            "never shared outside the company."
        ),
        y=238,
        height=40,
    )
    pdf.set_font(FONT_NAME, "B", 13)
    pdf.set_text_color(*INK)
    pdf.set_xy(MARGIN_MM, 283)
    pdf.cell(CONTENT_WIDTH_MM, 6, "Need help? Ask the plant office.", align="C")
    _safety_stripe(pdf, 291)
    return bytes(pdf.output())
