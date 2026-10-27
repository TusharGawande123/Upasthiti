"""Turns untrusted JPEG bytes into a picture the face models can read (spec M3 §7 rules 4 and 5).

The size is read from the JPEG header BEFORE the picture is decoded, so a small file that would
unpack into a huge picture (a "decompression bomb") is refused without using much memory.
"""

import io

import cv2
import numpy as np
from PIL import Image, UnidentifiedImageError

JPEG_START = b"\xff\xd8\xff"


class ImageInvalidError(Exception):
    """The bytes are not a JPEG of an allowed size."""


def decode_jpeg(
    data: bytes,
    *,
    min_width: int,
    max_width: int,
    min_height: int,
    max_height: int,
) -> np.ndarray:
    """Returns the picture as a BGR array (the colour order OpenCV and the models use)."""
    if not data.startswith(JPEG_START):
        raise ImageInvalidError("not a JPEG")
    try:
        with Image.open(io.BytesIO(data)) as header:
            width, height = header.size
            if header.format != "JPEG":
                raise ImageInvalidError("not a JPEG")
    except (UnidentifiedImageError, OSError) as error:
        raise ImageInvalidError("unreadable") from error
    if not (min_width <= width <= max_width and min_height <= height <= max_height):
        raise ImageInvalidError("size out of range")

    picture = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if picture is None or picture.shape[1] != width or picture.shape[0] != height:
        raise ImageInvalidError("unreadable")
    return picture
