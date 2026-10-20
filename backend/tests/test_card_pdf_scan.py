"""Print-and-scan test (S-23, AC-4, AC-41): the card PDFs are rendered to pictures and the QR
codes are read back with a different decoder (zxing-cpp). No database needed."""

from datetime import date

import pypdfium2 as pdfium
import pytest
import zxingcpp
from PIL import Image

from app.core.config import get_settings
from app.modules.printing.cards_pdf import (
    CARD_HEIGHT_MM,
    CARD_WIDTH_MM,
    CardFace,
    a4_sheets_pdf,
    qr_symbol,
    single_cards_pdf,
)
from app.modules.qr_cards.payload import build_payload

MM_PER_INCH = 25.4
POINTS_PER_INCH = 72
ISSUED_ON = date(2026, 10, 20)
# Webcams and phones see a card at about this sharpness; 2.0 = 144 dots per inch.
SCAN_SCALE = 2.0


def employee_face(number: int, **changes: object) -> CardFace:
    serial = f"C{number:06d}"
    values: dict[str, object] = {
        "serial": serial,
        "qr_text": build_payload(get_settings(), serial),
        "issued_on": ISSUED_ON,
        "employee_name": f"Worker Number {number}",
        "employee_code": f"T-{number}",
        "contractor_name": "Shree Manpower Services",
        "plant_name": "Sheet Shapers India Pvt Ltd (K-134)",
        "plant_code": "K134",
    }
    return CardFace(**{**values, **changes})  # type: ignore[arg-type]


def gate_test_card_face() -> CardFace:
    serial = "T000007"
    return CardFace(
        serial=serial,
        qr_text=build_payload(get_settings(), serial),
        issued_on=ISSUED_ON,
        is_test=True,
        label="Gate test K134",
    )


def pages_as_images(pdf_bytes: bytes, scale: float = SCAN_SCALE) -> list[Image.Image]:
    document = pdfium.PdfDocument(pdf_bytes)
    return [page.render(scale=scale).to_pil() for page in document]  # pyright: ignore[reportArgumentType]


def page_texts(pdf_bytes: bytes) -> list[str]:
    document = pdfium.PdfDocument(pdf_bytes)
    return [page.get_textpage().get_text_range() for page in document]


def decoded_texts(image: Image.Image) -> list[str]:
    return [barcode.text for barcode in zxingcpp.read_barcodes(image)]


# --- The QR code can be scanned ---------------------------------------------------------------


def test_the_qr_on_a_single_card_scans_back_to_the_payload() -> None:
    face = employee_face(123)

    [image] = pages_as_images(single_cards_pdf([face]))
    [barcode] = zxingcpp.read_barcodes(image)

    assert barcode.text == face.qr_text
    assert barcode.format == zxingcpp.BarcodeFormat.QRCode
    assert barcode.ec_level == "Q"  # a scratched card still reads (25% damage)


def test_the_qr_stays_at_version_7_or_smaller() -> None:
    # A bigger code needs a finer print. The signed text is about 118 characters.
    for serial in ("C000001", "C999999", "C123456789", "T000001"):
        payload = build_payload(get_settings(), serial)

        version = qr_symbol(payload).version
        assert isinstance(version, int) and version <= 7, serial


def test_a_test_card_scans_too() -> None:
    face = gate_test_card_face()

    [image] = pages_as_images(single_cards_pdf([face]))

    assert decoded_texts(image) == [face.qr_text]


def test_twelve_cards_make_two_a4_pages_and_every_qr_scans() -> None:
    faces = [employee_face(number) for number in range(1, 13)]

    pages = pages_as_images(a4_sheets_pdf(faces))

    assert len(pages) == 2
    assert sorted(decoded_texts(pages[0])) == sorted(face.qr_text for face in faces[:10])
    assert sorted(decoded_texts(pages[1])) == sorted(face.qr_text for face in faces[10:])


def test_a_card_still_scans_on_a_rough_low_resolution_picture() -> None:
    face = employee_face(5)
    [image] = pages_as_images(single_cards_pdf([face]), scale=1.4)  # about 100 dots per inch

    assert decoded_texts(image.convert("L")) == [face.qr_text]


# --- Size and layout --------------------------------------------------------------------------


def test_a_single_card_page_is_the_size_of_a_bank_card() -> None:
    document = pdfium.PdfDocument(single_cards_pdf([employee_face(1)]))

    width_pt, height_pt = document[0].get_size()

    assert width_pt == pytest.approx(CARD_WIDTH_MM / MM_PER_INCH * POINTS_PER_INCH, abs=0.5)
    assert height_pt == pytest.approx(CARD_HEIGHT_MM / MM_PER_INCH * POINTS_PER_INCH, abs=0.5)


def test_several_single_cards_make_one_page_each() -> None:
    pdf = single_cards_pdf([employee_face(number) for number in range(1, 4)])

    assert len(pdfium.PdfDocument(pdf)) == 3


def test_ten_cards_fit_one_a4_page_and_eleven_need_two() -> None:
    assert len(pdfium.PdfDocument(a4_sheets_pdf([employee_face(n) for n in range(1, 11)]))) == 1
    assert len(pdfium.PdfDocument(a4_sheets_pdf([employee_face(n) for n in range(1, 12)]))) == 2


# --- What is printed --------------------------------------------------------------------------


def test_the_card_shows_name_code_contractor_plant_serial_and_issue_date_but_no_end_date() -> None:
    [text] = page_texts(single_cards_pdf([employee_face(123, employee_name="Ravindra Pāṭil")]))

    for expected in (
        "Sheet Shapers",
        "Ravindra Pāṭil",  # accents print correctly (bundled font)
        "T-123",
        "Shree Manpower Services",
        "Sheet Shapers India Pvt Ltd (K-134)",
        "K134",
        "C000123",
        "Issued 20/10/2026",
        "A photo is taken at each punch",
    ):
        assert expected in text, expected
    assert "valid" not in text.lower()
    assert "until" not in text.lower()


def test_a_card_without_a_contractor_prints_no_contractor_line() -> None:
    [text] = page_texts(single_cards_pdf([employee_face(1, contractor_name=None)]))

    assert "Contractor" not in text


def test_a_test_card_says_so_and_shows_no_plant() -> None:
    [text] = page_texts(single_cards_pdf([gate_test_card_face()]))

    assert "TEST – NOT AN ID CARD" in text
    assert "Gate test K134" in text
    assert "T000007" in text
    assert "K134" in text  # only inside the label
    assert "Sheet Shapers India" not in text


def test_a_very_long_name_is_cut_instead_of_running_into_the_qr() -> None:
    name = "A" * 30 + " " + "B" * 30 + " " + "C" * 30
    face = employee_face(9, employee_name=name)

    [text] = page_texts(single_cards_pdf([face]))
    [image] = pages_as_images(single_cards_pdf([face]))

    assert "…" in text
    assert "C" * 30 not in text
    assert decoded_texts(image) == [face.qr_text]  # the code is still clean


def test_a_long_contractor_name_is_cut() -> None:
    face = employee_face(1, contractor_name="Precision Workforce Contractors " * 4)

    [text] = page_texts(single_cards_pdf([face]))

    assert "Contractor: Precision" in text
    assert "…" in text


def test_the_pdf_properties_hold_no_personal_data() -> None:
    pdf = single_cards_pdf([employee_face(1, employee_name="Sunil More")])

    metadata = pdfium.PdfDocument(pdf).get_metadata_dict()

    assert "Sunil" not in str(metadata)
    assert metadata.get("Title") == "Upasthiti ID cards"
