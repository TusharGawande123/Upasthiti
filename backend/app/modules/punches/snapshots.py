"""Checking and cleaning the photo a kiosk sends with a card punch (spec §7 rule 4).

The photo comes from a device we cannot trust, so it is treated as hostile input:
- it must be a real JPEG, at most 40 KB, between 160 x 120 and 640 x 640 pixels;
- the size is read from the file header BEFORE the picture is decoded, so a tiny file that claims
  to be 50,000 x 50,000 pixels (a "decompression bomb") is refused without using any memory;
- it is decoded fully (a cut-off file is refused) and saved again as a new JPEG at quality 75, which
  removes everything else it carried: location and camera data (EXIF), colour profiles, comments;
- its average brightness (0-255) is measured, so very dark photos can be marked (F-31).
"""

import io
from dataclasses import dataclass

from PIL import Image, ImageStat, UnidentifiedImageError

MAX_BYTES = 40 * 1024
MIN_WIDTH, MAX_WIDTH = 160, 640
MIN_HEIGHT, MAX_HEIGHT = 120, 640
OUTPUT_QUALITY = 75


class SnapshotInvalidError(Exception):
    """The photo is not an acceptable JPEG. The message is for logs and tests, not for people."""


@dataclass(frozen=True)
class CheckedSnapshot:
    jpeg: bytes  # the cleaned, re-encoded photo (this is what gets encrypted and stored)
    width: int
    height: int
    brightness: int  # average brightness, 0 (black) to 255 (white)
    is_dark: bool


def inspect_snapshot(raw: bytes, dark_threshold: int) -> CheckedSnapshot:
    """Check the photo and return the cleaned version, or raise SnapshotInvalidError."""
    if not raw:
        raise SnapshotInvalidError("empty")
    if len(raw) > MAX_BYTES:
        raise SnapshotInvalidError("too large")

    try:
        with Image.open(io.BytesIO(raw), formats=["JPEG"]) as image:
            width, height = image.size  # read from the header: nothing is decoded yet
            if not (MIN_WIDTH <= width <= MAX_WIDTH and MIN_HEIGHT <= height <= MAX_HEIGHT):
                raise SnapshotInvalidError("wrong size")
            image.load()  # decode everything; a truncated file fails here
            picture = image.convert("RGB")
            # Pillow copies a file's comment (and more) into this info dictionary and writes it
            # back when saving; emptying it is what makes the saved file clean.
            picture.info.clear()
    except SnapshotInvalidError:
        raise
    except UnidentifiedImageError, OSError, SyntaxError, ValueError, Image.DecompressionBombError:
        raise SnapshotInvalidError("not a readable JPEG") from None

    brightness = round(ImageStat.Stat(picture.convert("L")).mean[0])
    cleaned = io.BytesIO()
    # Nothing is passed on (no exif, colour profile or comment), so the new file carries none.
    picture.save(cleaned, format="JPEG", quality=OUTPUT_QUALITY, optimize=True)
    return CheckedSnapshot(
        jpeg=cleaned.getvalue(),
        width=width,
        height=height,
        brightness=brightness,
        is_dark=brightness < dark_threshold,
    )
