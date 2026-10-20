"""The fake camera clip for the end-to-end tests: refuses outside tests, and the QR in its
first frame decodes to the card's real signed text (zxing-cpp, as in the print test S-23)."""

from pathlib import Path

import pytest
import zxingcpp
from PIL import Image

from app.core.config import get_settings
from app.modules.qr_cards.payload import build_payload
from app.scripts import e2e_card_video as clip


def read_first_frame(path: Path) -> Image.Image:
    data = path.read_bytes()
    header_end = data.index(b"\n") + 1
    assert data[header_end : header_end + 6] == b"FRAME\n"
    start = header_end + 6
    luma = data[start : start + clip.WIDTH * clip.HEIGHT]
    return Image.frombytes("L", (clip.WIDTH, clip.HEIGHT), luma)


def test_the_clip_shows_the_signed_card_then_grey(tmp_path: Path) -> None:
    output = tmp_path / "card.y4m"

    assert clip.main(["C000123", str(output)]) == 0

    data = output.read_bytes()
    assert data.startswith(b"YUV4MPEG2 W320 H240 F5:1")
    frame_size = 6 + clip.WIDTH * clip.HEIGHT * 3 // 2
    assert data.count(b"FRAME\n") >= clip.CARD_FRAMES + clip.BLANK_FRAMES
    assert len(data) == data.index(b"\n") + 1 + frame_size * (clip.CARD_FRAMES + clip.BLANK_FRAMES)
    decoded = zxingcpp.read_barcodes(read_first_frame(output))
    assert [code.text for code in decoded] == [build_payload(get_settings(), "C000123")]


def test_the_script_refuses_outside_tests(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("APP_ENV", "production")

    assert clip.main(["C000123", str(tmp_path / "card.y4m")]) == 1
    assert not (tmp_path / "card.y4m").exists()


def test_the_script_needs_a_serial_and_a_file(tmp_path: Path) -> None:
    assert clip.main(["C000123"]) == 2
