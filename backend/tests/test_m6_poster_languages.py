"""The gate poster in English, Marathi and Hindi (M6 F-99, decision 0038; M2 AC-36 is the English
poster): one A4 page per language, the Devanagari font embedded for Marathi and Hindi, the same
legal facts in every language, and nothing that says "kiosk"."""

import pypdfium2
import pytest
from fastapi.testclient import TestClient
from fpdf import FPDF

from app.modules.printing import poster_pdf
from app.modules.printing.poster_texts import ENGLISH, HINDI, MARATHI, POSTER_LANGUAGES
from tests.people_helpers import PlantIds

# ruff: noqa: F401, F811 (the fixtures are the ones of the poster tests)
from tests.test_kiosk_sound_and_poster import boss, head, k134, poster_text

pytestmark = pytest.mark.time_sensitive

# A word of each language that must be on the page (the text layer of shaped Devanagari splits
# some vowel signs, so only short stable words are compared).
TITLE_BY_LANGUAGE = {
    "en": "Attendance at this gate",
    "mr": "गेटवरील",
    "hi": "इस गेट पर",
}
EMBEDDED_FONT = b"NotoSansDevanagari"


def poster_url(plant: PlantIds, language: str | None) -> str:
    suffix = "" if language is None else f"?language={language}"
    return f"/api/v1/plants/{plant.id}/gate-poster.pdf{suffix}"


@pytest.mark.parametrize("language", POSTER_LANGUAGES)
def test_m6_f99_each_language_is_one_a4_page_with_its_own_words(
    boss: TestClient, k134: PlantIds, language: str
) -> None:
    response = boss.get(poster_url(k134, language))
    text = poster_text(response)  # also checks one A4 page

    assert TITLE_BY_LANGUAGE[language] in text
    assert "K134" in text and "60" in text  # the plant and the retention days, in every language
    assert "kiosk" not in text.lower()
    # The names of what the worker sees on the gate screen stay as written there.
    assert "NOT ACCEPTED" in text and "IN" in text and "OUT" in text


def test_m6_f99_no_language_means_english(boss: TestClient, k134: PlantIds) -> None:
    assert poster_text(boss.get(poster_url(k134, None))) == poster_text(
        boss.get(poster_url(k134, "en"))
    )


@pytest.mark.parametrize("language", ["mr", "hi"])
def test_m6_f99_the_devanagari_font_is_embedded_for_marathi_and_hindi(
    boss: TestClient, k134: PlantIds, language: str
) -> None:
    content = boss.get(poster_url(k134, language)).content

    assert EMBEDDED_FONT in content
    assert b"/FontFile2" in content  # a TrueType font program is inside the file


def test_m6_f99_the_english_poster_does_not_carry_the_devanagari_font(
    boss: TestClient, k134: PlantIds
) -> None:
    assert EMBEDDED_FONT not in boss.get(poster_url(k134, "en")).content


@pytest.mark.parametrize("language", ["fr", "EN", "../x", ""])
def test_m6_f99_an_unknown_poster_language_is_refused(
    boss: TestClient, k134: PlantIds, language: str
) -> None:
    response = boss.get(poster_url(k134, language))

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_FAILED"


def test_m6_f99_a_plant_head_may_print_the_poster_in_marathi(
    head: TestClient, k134: PlantIds
) -> None:
    assert TITLE_BY_LANGUAGE["mr"] in poster_text(head.get(poster_url(k134, "mr")))


@pytest.mark.parametrize("language", ["en", "mr", "hi"])
@pytest.mark.parametrize("retention_days", [1, 60, 365])
def test_m6_f99_the_privacy_box_fits_above_the_help_line_in_every_language(
    language: str, retention_days: int
) -> None:
    pdf = poster_pdf._new_poster_pdf(language)
    pdf.add_page()
    texts = poster_pdf.poster_texts(language)
    box_top = (
        poster_pdf.WAYS_Y_MM
        + poster_pdf.WAYS_HEIGHT_MM
        + 3
        + poster_pdf.SMALL_BOX_HEIGHT_MM
        + 3
        + poster_pdf.shifts_box_height(pdf, 9, texts)
        + 3
    )

    height = poster_pdf.privacy_box_height(pdf, retention_days, texts)

    assert height <= poster_pdf.BOTTOM_LIMIT_MM - box_top


@pytest.mark.parametrize("language", ["mr", "hi"])
def test_m6_f99_a_long_shift_line_shrinks_to_fit_the_box(language: str) -> None:
    """The Marathi and Hindi shift line is wider than the English one: the poster measures it and
    shrinks the times (never below the minimum size) so it stays inside the box."""
    texts = poster_pdf.poster_texts(language)
    pdf = poster_pdf._new_poster_pdf(language)
    pdf.add_page()
    pieces = (
        (False, f"23:59–23:59{texts.shift_on_time}"),
        (True, "23:59"),
        (False, texts.shift_leave),
        (True, "23:59"),
        (False, "."),
    )
    room = poster_pdf.CONTENT_WIDTH_MM - 10 - poster_pdf.NAME_WIDTH

    size = poster_pdf.SHIFT_SIZE
    while size > poster_pdf.MIN_SHIFT_SIZE and poster_pdf._pieces_width(pdf, pieces, size) > room:
        size -= 0.5

    assert poster_pdf._pieces_width(pdf, pieces, size) <= room


def test_m6_f99_the_three_texts_have_the_same_fields_filled() -> None:
    """A translation must not leave a field empty or lose the numbers' placeholders."""
    for texts in (ENGLISH, MARATHI, HINDI):
        for name, value in vars(texts).items():
            assert value, name
        assert "{days}" in texts.privacy_notice
        assert "{date}" in texts.shifts_as_on
        assert "{count}" in texts.shifts_more and "{count}" in texts.shifts_more_one
        assert "kiosk" not in " ".join(str(value) for value in vars(texts).values()).lower()
