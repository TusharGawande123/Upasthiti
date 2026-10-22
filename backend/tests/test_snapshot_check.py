"""The photo check of a card punch: size limits, real JPEG only, metadata removed, brightness
(spec M2 §7 rule 4, AC-17, AC-34). Pure functions: no database needed."""

import io
import struct

import pytest
from PIL import Image

from app.modules.punches.snapshots import MAX_BYTES, SnapshotInvalidError, inspect_snapshot
from tests.image_helpers import make_jpeg, make_png

DARK_LIMIT = 40


def inspect(raw: bytes):
    return inspect_snapshot(raw, DARK_LIMIT)


def test_a_normal_photo_is_accepted_and_measured() -> None:
    checked = inspect(make_jpeg(320, 240, (200, 200, 200)))

    assert (checked.width, checked.height) == (320, 240)
    assert abs(checked.brightness - 200) <= 2  # JPEG compression moves colours slightly
    assert checked.is_dark is False
    assert Image.open(io.BytesIO(checked.jpeg)).format == "JPEG"


@pytest.mark.parametrize("size", [(160, 120), (640, 640), (640, 120), (160, 640)])
def test_the_size_limits_include_their_edges(size: tuple[int, int]) -> None:
    assert inspect(make_jpeg(*size)).width == size[0]


@pytest.mark.parametrize("size", [(159, 240), (320, 119), (641, 240), (320, 641), (50, 50)])
def test_a_photo_outside_the_size_limits_is_refused(size: tuple[int, int]) -> None:
    with pytest.raises(SnapshotInvalidError):
        inspect(make_jpeg(*size))


def test_a_dark_photo_is_accepted_but_marked() -> None:
    assert inspect(make_jpeg(colour=(10, 10, 10))).is_dark is True
    assert inspect(make_jpeg(colour=(39, 39, 39))).is_dark is True
    assert inspect(make_jpeg(colour=(40, 40, 40))).is_dark is False


def test_nothing_or_a_file_over_40_kb_is_refused() -> None:
    with pytest.raises(SnapshotInvalidError):
        inspect(b"")
    with pytest.raises(SnapshotInvalidError):
        inspect(make_jpeg() + b"\x00" * MAX_BYTES)


def test_only_real_jpeg_files_are_accepted() -> None:
    for not_a_jpeg in (make_png(), b"hello, I am not a picture", b"\xff\xd8\xff garbage"):
        with pytest.raises(SnapshotInvalidError):
            inspect(not_a_jpeg)


def test_a_cut_off_jpeg_is_refused() -> None:
    complete = make_jpeg()
    with pytest.raises(SnapshotInvalidError):
        inspect(complete[: len(complete) // 2])


def test_a_tiny_file_that_claims_a_huge_picture_is_refused_without_decoding_it() -> None:
    bomb = bytearray(make_jpeg())
    # The size sits in the "start of frame" marker (FFC0 / FFC2): length, precision, height, width.
    marker = bomb.find(b"\xff\xc0")
    assert marker != -1
    struct.pack_into(">HH", bomb, marker + 5, 60_000, 60_000)

    with pytest.raises(SnapshotInvalidError):
        inspect(bytes(bomb))


def test_camera_and_comment_data_are_removed() -> None:
    original = make_jpeg(with_metadata=True)
    assert b"Test camera maker" in original
    assert b"secret comment" in original

    cleaned = inspect(original).jpeg

    assert b"Test camera maker" not in cleaned
    assert b"secret comment" not in cleaned
    assert not Image.open(io.BytesIO(cleaned)).getexif()
