"""Makes a fake camera clip of one QR card, for the end-to-end tests only:

    APP_ENV=test uv run python -m app.scripts.e2e_card_video C000001 ../e2e/.tmp/card.y4m

Chromium plays the clip as its camera (--use-file-for-fake-video-capture) and repeats it:
about 1.5 s showing the card, then 20 s of plain grey (so the same card is read again only
every 21.5 s, giving the test time between scans). The QR text is signed with QR_SIGNING_KEY
from the environment, exactly like a printed card. It refuses to run unless APP_ENV=test.

The clip is an uncompressed .y4m file (320 x 240, 5 frames a second): a format Chromium reads
without any codec. It is written to a git-ignored folder and never committed.
"""

import os
import sys
from pathlib import Path

import segno
from PIL import Image

from app.core.config import get_settings
from app.modules.qr_cards.payload import build_payload

WIDTH, HEIGHT = 320, 240
FRAMES_PER_SECOND = 5
CARD_FRAMES = 8  # about 1.5 s
BLANK_FRAMES = 100  # 20 s
QR_SCALE = 4  # pixels per QR module: a version 7 code with its border fits in 240 px
GREY = 150  # the blank frames: not dark, so the low-light hint stays off


def card_picture(qr_text: str) -> Image.Image:
    """The card's QR code, black on white, in the middle of a white frame."""
    code = segno.make(qr_text, error="q", micro=False)
    qr_size = int(code.symbol_size(scale=QR_SCALE, border=4)[0])
    picture = Image.new("L", (WIDTH, HEIGHT), 255)
    rows = list(code.matrix_iter(scale=QR_SCALE, border=4))
    qr = Image.new("L", (qr_size, qr_size), 255)
    qr.putdata([0 if dark else 255 for row in rows for dark in row])
    picture.paste(qr, ((WIDTH - qr_size) // 2, (HEIGHT - qr_size) // 2))
    return picture


def frame_bytes(picture: Image.Image) -> bytes:
    """One 4:2:0 frame: the brightness plane, then two neutral colour planes."""
    colour_plane = bytes([128]) * ((WIDTH // 2) * (HEIGHT // 2))
    return b"FRAME\n" + picture.tobytes() + colour_plane + colour_plane


def write_clip(qr_text: str, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    card = frame_bytes(card_picture(qr_text))
    blank = frame_bytes(Image.new("L", (WIDTH, HEIGHT), GREY))
    header = f"YUV4MPEG2 W{WIDTH} H{HEIGHT} F{FRAMES_PER_SECOND}:1 Ip A1:1 C420jpeg\n"
    with output.open("wb") as clip:
        clip.write(header.encode("ascii"))
        for _ in range(CARD_FRAMES):
            clip.write(card)
        for _ in range(BLANK_FRAMES):
            clip.write(blank)


def main(arguments: list[str]) -> int:
    if os.environ.get("APP_ENV") != "test":
        print("Refused: this script is only for the end-to-end tests (APP_ENV=test).")
        return 1
    if len(arguments) != 2:
        print("Usage: python -m app.scripts.e2e_card_video <card serial> <output.y4m>")
        return 2
    serial, output = arguments
    write_clip(build_payload(get_settings(), serial), Path(output))
    print(f"Wrote {output}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
