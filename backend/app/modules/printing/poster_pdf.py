"""The gate poster (F-34, spec M2 §7 rule 20, M3 §4.14): one A4 page per plant, put up next to the
attendance device.

It teaches changing workers how to punch without anyone explaining it (a card, or a face), and it
is the DPDP notice at the gate: why a photo is taken, how long it is kept, who can see it, where
the full privacy notice is. No personal data. Design: docs/design-refs/m3/gate-c/ (decision 0020).
Icons are Lucide SVGs (ISC, `icons/`) and one own drawing (`head-turn.svg`), drawn as vectors so
the poster prints sharp at any size.

The words are in poster_texts.py (English, Marathi, Hindi: M6 F-99). Marathi and Hindi are written
in Noto Sans Devanagari, shaped by uharfbuzz through fpdf2 (the joined letters need shaping); Latin
text in those posters (plant name, IN, OUT) comes from Inter, because Noto Sans Devanagari has no
Latin letters.
"""

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from pathlib import Path

from fpdf import FPDF

from app.modules.printing.cards_pdf import FONT_FOLDER, FONT_NAME
from app.modules.printing.poster_texts import (
    DEFAULT_POSTER_LANGUAGE,
    ENGLISH,
    PosterTexts,
    poster_texts,
)

DEVANAGARI_FONT_NAME = "NotoSansDevanagari"
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


class PosterPdf(FPDF):
    """An FPDF that knows which font family the poster's text is written in."""

    poster_family: str = FONT_NAME


def _family(pdf: FPDF) -> str:
    # A plain FPDF (the tests measure with one) means the Latin font.
    return getattr(pdf, "poster_family", FONT_NAME)


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


def _wrapped_lines(pdf: FPDF, text: str, width: float) -> list[str]:
    """Breaks the text into lines no wider than `width` in the current font. fpdf2's multi_cell
    garbles lines that mix Devanagari with the Latin fallback font, so the poster wraps the words
    itself and draws each line with a plain cell (which fpdf2 handles correctly)."""
    lines: list[str] = []
    for paragraph in text.split("\n"):
        line = ""
        for word in paragraph.split(" "):
            candidate = f"{line} {word}" if line else word
            if pdf.get_string_width(candidate) <= width:
                line = candidate
                continue
            if line:
                lines.append(line)
            line = ""
            # A single word wider than the line (a very long plant name) is cut by letters.
            for letter in word:
                if line and pdf.get_string_width(line + letter) > width:
                    lines.append(line)
                    line = ""
                line += letter
        lines.append(line)
    return lines


def _cell(pdf: FPDF, width: float, height: float, text: str, align: str = "L") -> None:
    """One line of text. A line that used the Latin fallback font leaves fpdf2 believing the main
    font is still selected on the page, so the next line would come out in the wrong font:
    forgetting that belief makes fpdf2 select the font again."""
    pdf.current_font_is_set_on_page = False
    pdf.cell(width, height, text, align=align)


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
    align: str = "L",
) -> float:
    """Writes wrapped text and returns the y below it."""
    pdf.set_font(_family(pdf), "B" if bold else "", size)
    pdf.set_text_color(*colour)
    row_y = y
    for text_line in _wrapped_lines(pdf, text, width):
        pdf.set_xy(x, row_y)
        _cell(pdf, width, line, text_line, align=align)
        row_y += line
    pdf.set_xy(x, row_y)
    return row_y


def _text_height(pdf: FPDF, width: float, size: float, line: float, text: str, bold: bool) -> float:
    pdf.set_font(_family(pdf), "B" if bold else "", size)
    return len(_wrapped_lines(pdf, text, width)) * line


def _card_box(pdf: FPDF, y: float, height: float, texts: PosterTexts) -> None:
    x = MARGIN_MM
    _box(pdf, x, y, WAY_BOX_WIDTH_MM, height)
    _icon(pdf, "id-card", x + 6, y + 6, 15)
    inner = WAY_BOX_WIDTH_MM - 12
    below = _text(pdf, x + 25, y + 5, inner - 19, 13.5, 6, texts.card_title, bold=True)
    below = _text(
        pdf,
        x + 6,
        max(below, y + 23) + 2,
        inner,
        12,
        5.2,
        texts.card_hold,
        colour=MUTED,
    )
    _text(
        pdf,
        x + 6,
        below + 2,
        inner,
        12,
        5.2,
        texts.card_photo,
        colour=MUTED,
    )


def _face_box(pdf: FPDF, y: float, height: float, texts: PosterTexts) -> None:
    x = MARGIN_MM + WAY_BOX_WIDTH_MM + GAP_MM
    _box(pdf, x, y, WAY_BOX_WIDTH_MM, height)
    inner = WAY_BOX_WIDTH_MM - 12
    below = _text(pdf, x + 6, y + 5, inner, 13.5, 6, texts.face_title, bold=True)
    row_x = x + 6
    text_x = row_x + 24
    text_width = WAY_BOX_WIDTH_MM - 12 - 24
    row_y = below + 2

    # 1. The blue button, as on the gate screen (its words are the screen's, in every language).
    pdf.set_fill_color(*BUTTON_BLUE)
    pdf.rect(row_x, row_y, 22, 13, style="F", round_corners=True, corner_radius=2.5)
    _text(pdf, row_x, row_y + 2, 22, 8, 4.2, texts.face_button, bold=True, colour=WHITE, align="C")
    _text(pdf, text_x, row_y + 3, text_width, 11.5, 5, texts.face_tap)

    # 2. The head turn.
    row_y += 14
    _icon(pdf, "head-turn", row_x + 4, row_y - 1, 14)
    _text(pdf, text_x, row_y, text_width, 11.5, 5, texts.face_turn)

    # 3. The employee code, if the screen asks for it.
    row_y += 15
    _box(pdf, row_x, row_y, 22, 11)
    pdf.set_font(_family(pdf), "B", 12)
    pdf.set_text_color(*INK)
    pdf.set_xy(row_x, row_y + 2.5)
    _cell(pdf, 22, 6, "0123", align="C")
    _text(pdf, text_x, row_y, text_width, 11.5, 5, texts.face_code)


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


# The privacy text is a little smaller than the "how to punch" text so the M4 offline paragraph
# (what happens to a punch when the gate has no internet; spec §4.2, §4.12, §8.1) fits on the one
# A4 page; the face box above cannot get shorter.
PRIVACY_SIZE, PRIVACY_LINE = 11.0, 4.9
PARAGRAPH_AIR_MM = 1.5


def _privacy_paragraphs(retention_days: int, texts: PosterTexts) -> list[str]:
    return [
        texts.privacy_notice.format(days=retention_days),
        texts.privacy_rights,
        texts.offline_notice,
    ]


@dataclass(frozen=True)
class PosterShift:
    """One line of the "Your shift times" box (M5 spec §4.17): the rules in force today."""

    name: str
    start: time
    end: time
    grace_min: int  # after the start
    grace_after_end_min: int = 30  # after the end


MAX_POSTER_SHIFTS = 6
SHIFT_SIZE = 14.0
SHIFT_LINE, SHIFT_LINE_COMPACT = 6.5, 5.3  # compact: more than three shifts


# The grace after the end ("OUT allowed until"): with up to three shifts it sits on a small second
# line under the times. With more shifts there is no height left on the page, so all of it goes on
# one line in a smaller size (a test checks both fit).
OUT_SIZE = 11.0
OUT_LINE = 3.8
SHIFT_SIZE_COMPACT = 10.0
MIN_SHIFT_SIZE = 8.0
NAME_WIDTH, NAME_WIDTH_COMPACT = 34.0, 28.0


def _shift_line_height(shift_count: int) -> float:
    return SHIFT_LINE if shift_count <= 3 else SHIFT_LINE_COMPACT


def _out_on_own_line(shift_count: int) -> bool:
    return shift_count <= 3


def _clock(moment: time) -> str:
    return f"{moment:%H:%M}"


def _on_time_until(shift: PosterShift) -> time:
    """The start plus the grace (grace is only at the start, decision 0036 line 8)."""
    started = datetime.combine(date.today(), shift.start)
    return (started + timedelta(minutes=shift.grace_min)).time()


def _out_until(shift: PosterShift) -> time:
    """The shift end plus the grace after the end (decision 0036 line 79); shown only."""
    ended = datetime.combine(date.today(), shift.end)
    return (ended + timedelta(minutes=shift.grace_after_end_min)).time()


def shifts_box_height(pdf: FPDF, shift_count: int, texts: PosterTexts = ENGLISH) -> float:
    """Header, one line per shown shift (and the "and N more" line) and the two rule lines."""
    lines = min(shift_count, MAX_POSTER_SHIFTS)  # the "and N more" line takes the sixth place
    rules = sum(
        _text_height(pdf, CONTENT_WIDTH_MM - 10, SHIFT_SIZE, 6, rule, True)
        for rule in texts.shift_rules
    )
    out_lines = shift_count * OUT_LINE if _out_on_own_line(shift_count) else 0
    return 11 + 2 + lines * _shift_line_height(shift_count) + out_lines + 3 + rules + 1


def _shifts_box(
    pdf: FPDF, y: float, shifts: list[PosterShift], made_on: date, texts: PosterTexts
) -> float:
    """The blue-headed box with one line per active shift. Returns the y below it."""
    height = shifts_box_height(pdf, len(shifts), texts)
    pdf.set_fill_color(*BUTTON_BLUE)
    pdf.rect(MARGIN_MM, y, CONTENT_WIDTH_MM, 11, style="F", round_corners=True, corner_radius=4)
    pdf.rect(MARGIN_MM, y + 6, CONTENT_WIDTH_MM, 5, style="F")  # square the lower corners
    pdf.set_draw_color(*BUTTON_BLUE)
    pdf.set_line_width(0.8)
    pdf.rect(MARGIN_MM, y, CONTENT_WIDTH_MM, height, style="D", round_corners=True, corner_radius=4)
    _icon(pdf, "clock", MARGIN_MM + 5, y + 2, 7)
    pdf.set_text_color(*WHITE)
    pdf.set_font(_family(pdf), "B", 16)
    pdf.set_xy(MARGIN_MM + 15, y + 2)
    _cell(pdf, 80, 7, texts.shifts_title)
    pdf.set_font(_family(pdf), "B", 11)
    pdf.set_xy(MARGIN_MM + CONTENT_WIDTH_MM - 85, y + 2)
    _cell(pdf, 80, 7, texts.shifts_as_on.format(date=f"{made_on:%d/%m/%Y}"), align="R")

    row_y = y + 13
    own_line = _out_on_own_line(len(shifts))
    name_width = NAME_WIDTH if own_line else NAME_WIDTH_COMPACT
    # With more than six shifts, five are listed and the sixth line says how many are left out:
    # the page has room for six lines, never seven (decision 0036 line 19).
    shown = shifts if len(shifts) <= MAX_POSTER_SHIFTS else shifts[: MAX_POSTER_SHIFTS - 1]
    line = _shift_line_height(len(shifts))
    for shift in shown:
        _shift_line(pdf, row_y, shift, name_width, line, texts, with_out=not own_line)
        row_y += line
        if own_line:
            row_y = _out_until_line(pdf, row_y, shift, name_width, texts)
    if len(shifts) > MAX_POSTER_SHIFTS:
        more = len(shifts) - len(shown)
        more_text = texts.shifts_more_one if more == 1 else texts.shifts_more
        row_y = _text(
            pdf,
            MARGIN_MM + 5,
            row_y,
            CONTENT_WIDTH_MM - 10,
            SHIFT_SIZE,
            line,
            more_text.format(count=more),
            colour=MUTED,
        )
    row_y += 2
    pdf.set_draw_color(*INK)
    pdf.set_line_width(0.3)
    pdf.line(MARGIN_MM + 5, row_y, MARGIN_MM + CONTENT_WIDTH_MM - 5, row_y)
    row_y += 2
    for rule in texts.shift_rules:
        row_y = _text(
            pdf, MARGIN_MM + 5, row_y, CONTENT_WIDTH_MM - 10, SHIFT_SIZE, 6, rule, bold=True
        )
    return y + height


def _shift_line(
    pdf: FPDF,
    y: float,
    shift: PosterShift,
    name_width: float,
    line: float,
    texts: PosterTexts,
    with_out: bool,
) -> None:
    """ "Office  09:00-17:00: on time until 09:30, leave from 17:00." with the key times bold.
    `with_out` adds "OUT allowed until 17:30." on the same line (smaller size, many shifts)."""
    size = SHIFT_SIZE_COMPACT if with_out else SHIFT_SIZE
    pdf.set_text_color(*INK)
    pdf.set_font(_family(pdf), "B", size)
    name = shift.name
    while name and pdf.get_string_width(name) > name_width - 2:
        name = name[:-1]
    pdf.set_xy(MARGIN_MM + 5, y)
    _cell(pdf, name_width, line, name if name == shift.name else name.rstrip() + "…")
    pieces = (
        (False, f"{_clock(shift.start)}–{_clock(shift.end)}{texts.shift_on_time}"),
        (True, _clock(_on_time_until(shift))),
        (False, texts.shift_leave),
        (True, _clock(shift.end)),
        (False, "."),
    )
    if with_out:
        pieces += (
            (False, texts.shift_out_inline),
            (True, _clock(_out_until(shift))),
            (False, "."),
        )
    # Marathi and Hindi words are longer: the times shrink a little until the line fits the box.
    room = CONTENT_WIDTH_MM - 10 - name_width
    while size > MIN_SHIFT_SIZE and _pieces_width(pdf, pieces, size) > room:
        size -= 0.5
    for bold, text in pieces:
        pdf.set_font(_family(pdf), "B" if bold else "", size)
        _cell(pdf, pdf.get_string_width(text) + 0.2, line, text)
    if with_out:
        _row_rule(pdf, y + line)


def _pieces_width(pdf: FPDF, pieces: tuple[tuple[bool, str], ...], size: float) -> float:
    total = 0.0
    for bold, text in pieces:
        pdf.set_font(_family(pdf), "B" if bold else "", size)
        total += pdf.get_string_width(text) + 0.2
    return total


def _row_rule(pdf: FPDF, y: float) -> None:
    pdf.set_draw_color(205, 212, 224)
    pdf.set_line_width(0.2)
    pdf.line(MARGIN_MM + 5, y, MARGIN_MM + CONTENT_WIDTH_MM - 5, y)


def _out_until_line(
    pdf: FPDF, y: float, shift: PosterShift, indent: float, texts: PosterTexts
) -> float:
    """The small "OUT allowed until 17:30." line under the shift times; returns the y below it."""
    line = OUT_LINE
    pdf.set_xy(MARGIN_MM + 5 + indent, y)
    pieces = ((False, texts.shift_out_line), (True, _clock(_out_until(shift))), (False, "."))
    for bold, text in pieces:
        pdf.set_font(_family(pdf), "B" if bold else "", OUT_SIZE)
        _cell(pdf, pdf.get_string_width(text) + 0.2, line, text)
    _row_rule(pdf, y + line)
    return y + line


def privacy_box_height(pdf: FPDF, retention_days: int, texts: PosterTexts = ENGLISH) -> float:
    """The height the privacy box needs (a test checks it fits above the help line)."""
    text_width = CONTENT_WIDTH_MM - 36
    content = _text_height(pdf, text_width, 15, 7, texts.privacy_heading, True) + _text_height(
        pdf, text_width, 13, 5.5, texts.privacy_lead, True
    )
    for paragraph in _privacy_paragraphs(retention_days, texts):
        content += PARAGRAPH_AIR_MM + _text_height(
            pdf, text_width, PRIVACY_SIZE, PRIVACY_LINE, paragraph, False
        )
    return content + 8


def _privacy_box(pdf: FPDF, y: float, retention_days: int, texts: PosterTexts) -> None:
    """The DPDP notice: what the punches keep, who sees it, and what happens offline. Where to
    read more is on the help line below the box."""
    text_x = MARGIN_MM + 30
    text_width = CONTENT_WIDTH_MM - 36
    height = min(privacy_box_height(pdf, retention_days, texts), BOTTOM_LIMIT_MM - y)
    _box(pdf, MARGIN_MM, y, CONTENT_WIDTH_MM, height)
    _icon(pdf, "shield-check", MARGIN_MM + 6, y + 5, 18)
    below = _text(pdf, text_x, y + 4, text_width, 15, 7, texts.privacy_heading, bold=True)
    below = _text(pdf, text_x, below, text_width, 13, 5.5, texts.privacy_lead, bold=True)
    for paragraph in _privacy_paragraphs(retention_days, texts):
        below = _text(
            pdf, text_x, below + PARAGRAPH_AIR_MM, text_width, PRIVACY_SIZE, PRIVACY_LINE, paragraph
        )


def _help_line(pdf: FPDF, privacy_address: str, texts: PosterTexts) -> None:
    """ "Need help? Ask the plant office." and the address of the full privacy notice, centred
    on one line above the bottom stripe."""
    help_text = texts.help_text
    more = f"   {texts.privacy_address_label} {privacy_address}"
    pdf.set_text_color(*INK)
    for size in (12, 11, 10, 9):
        pdf.set_font(_family(pdf), "B", size)
        help_width = pdf.get_string_width(help_text)
        pdf.set_font(_family(pdf), "", size)
        total = help_width + pdf.get_string_width(more)
        if total <= CONTENT_WIDTH_MM or size == 9:
            break
    pdf.set_xy(MARGIN_MM + max(0.0, (CONTENT_WIDTH_MM - total) / 2), 284)
    pdf.set_font(_family(pdf), "B", size)
    _cell(pdf, help_width, 6, help_text)
    pdf.set_font(_family(pdf), "", size)
    _cell(pdf, 0, 6, more)


def _plant_line(pdf: FPDF, text: str) -> None:
    """The plant under the title. Plant names can be long (120 letters): the font shrinks until
    the line fits; the longest names wrap onto a second line."""
    pdf.set_text_color(*MUTED)
    for size in (16, 14, 12):
        pdf.set_font(_family(pdf), "", size)
        if pdf.get_string_width(text) <= CONTENT_WIDTH_MM:
            pdf.set_xy(MARGIN_MM, 26)
            _cell(pdf, CONTENT_WIDTH_MM, 8, text)
            return
    _text(pdf, MARGIN_MM, 25, CONTENT_WIDTH_MM, 11, 5, text, colour=MUTED)


def _new_poster_pdf(language: str) -> PosterPdf:
    """The page with its fonts. English uses Inter alone; Marathi and Hindi use Noto Sans
    Devanagari with text shaping, and Inter for the Latin letters it does not have."""
    pdf = PosterPdf(format="A4", unit="mm")
    pdf.set_auto_page_break(False)
    pdf.add_font(FONT_NAME, "", str(FONT_FOLDER / "Inter-Regular.ttf"))
    pdf.add_font(FONT_NAME, "B", str(FONT_FOLDER / "Inter-Bold.ttf"))
    if language != DEFAULT_POSTER_LANGUAGE:
        pdf.add_font(DEVANAGARI_FONT_NAME, "", str(FONT_FOLDER / "NotoSansDevanagari-Regular.ttf"))
        pdf.add_font(DEVANAGARI_FONT_NAME, "B", str(FONT_FOLDER / "NotoSansDevanagari-Bold.ttf"))
        pdf.set_text_shaping(True)
        pdf.set_fallback_fonts([FONT_NAME])
        pdf.poster_family = DEVANAGARI_FONT_NAME
    return pdf


def gate_poster_pdf(
    plant_name: str,
    plant_code: str,
    retention_days: int,
    privacy_address: str,
    shifts: list[PosterShift],
    made_on: date,
    language: str = DEFAULT_POSTER_LANGUAGE,
) -> bytes:
    """`privacy_address` is printed as text (for example "example.app/privacy"), never as a QR
    code: next to the card codes at the gate it could be mistaken for one (decision 0020).
    `shifts` are the plant's active shifts with the rules in force on `made_on` (M5 spec §4.17).
    `language` is en, mr or hi (the router checks it)."""
    texts = poster_texts(language)
    pdf = _new_poster_pdf(language)
    pdf.set_title(f"Gate poster - {plant_code}")
    pdf.add_page()

    _safety_stripe(pdf, 0)
    pdf.set_text_color(*INK)
    pdf.set_font(_family(pdf), "B", 30)
    pdf.set_xy(MARGIN_MM, 12)
    _cell(pdf, CONTENT_WIDTH_MM, 13, texts.title)
    _plant_line(pdf, f"{plant_name} · {plant_code}")

    _text(pdf, MARGIN_MM, 36, CONTENT_WIDTH_MM, 16, 7, texts.ways_heading, bold=True)
    _card_box(pdf, WAYS_Y_MM, WAYS_HEIGHT_MM, texts)
    _face_box(pdf, WAYS_Y_MM, WAYS_HEIGHT_MM, texts)
    small_height = SMALL_BOX_HEIGHT_MM
    small_y = WAYS_Y_MM + WAYS_HEIGHT_MM + 3
    _small_box(pdf, 0, "log-in", texts.see_title, texts.see_text, small_y, small_height)
    _small_box(pdf, 1, "octagon-x", texts.refused_title, texts.refused_text, small_y, small_height)
    below = small_y + small_height + 3
    below = _shifts_box(pdf, below, shifts, made_on, texts)
    _privacy_box(pdf, below + 3, retention_days, texts)
    _help_line(pdf, privacy_address, texts)
    _safety_stripe(pdf, 291)
    return bytes(pdf.output())
