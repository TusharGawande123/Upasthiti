"""Fake photos for tests: plain colour pictures made with Pillow. No real faces, no real people."""

import io

from PIL import Image


def make_jpeg(
    width: int = 320,
    height: int = 240,
    colour: tuple[int, int, int] = (120, 130, 140),
    *,
    quality: int = 70,
    with_metadata: bool = False,
) -> bytes:
    picture = Image.new("RGB", (width, height), colour)
    extra: dict[str, object] = {}
    if with_metadata:
        exif = Image.Exif()
        exif[0x010F] = "Test camera maker"  # tag "Make"
        extra = {"exif": exif.tobytes(), "comment": b"secret comment"}
    buffer = io.BytesIO()
    picture.save(buffer, format="JPEG", quality=quality, **extra)
    return buffer.getvalue()


def make_png(width: int = 320, height: int = 240) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (10, 20, 30)).save(buffer, format="PNG")
    return buffer.getvalue()
