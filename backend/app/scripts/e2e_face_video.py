"""Makes a fake camera clip of one made-up person turning their head, for the end-to-end tests only:

    APP_ENV=test uv run python -m app.scripts.e2e_face_video 5 ../e2e/.tmp/face.y4m

Chromium plays the clip as its camera (--use-file-for-fake-video-capture) and repeats it. The
clip holds each enrolment pose for 3 s in the order of the wizard (straight, left, right, up,
down), then starts again, so a test can take each shot when the clip shows the right pose. The
pictures are painted for the fake face engine (FACE_ENGINE=fake, see app/face/fake_engine.py):
they show grey marks, never a real face. It refuses to run unless APP_ENV=test.

The clip is an uncompressed .y4m file, 640 x 480 like the pictures the wizard sends (the fake
engine reads its marks at fixed pixel places), 2 frames a second to keep the file small. It is
written to a git-ignored folder and never committed.
"""

import os
import sys
from pathlib import Path

import cv2
import numpy as np

from app.face.fake_engine import make_fake_frame

WIDTH, HEIGHT = 640, 480
FRAMES_PER_SECOND = 2
FRAMES_PER_POSE = 6  # 3 s
# (yaw, pitch) of each pose, the same values the backend tests paint (tests/face_helpers.py).
POSES = ((0, 0), (20, 0), (-20, 0), (0, 20), (0, -20))


def frame_bytes(person: int, yaw: float, pitch: float) -> bytes:
    """One 4:2:0 frame: the brightness plane, then the two colour planes."""
    jpeg = make_fake_frame(person, yaw_degrees=yaw, pitch_degrees=pitch)
    picture = cv2.imdecode(np.frombuffer(jpeg, dtype=np.uint8), cv2.IMREAD_COLOR)
    if picture is None:
        raise RuntimeError("could not read the painted picture")
    return b"FRAME\n" + cv2.cvtColor(picture, cv2.COLOR_BGR2YUV_I420).tobytes()


def write_clip(person: int, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    header = f"YUV4MPEG2 W{WIDTH} H{HEIGHT} F{FRAMES_PER_SECOND}:1 Ip A1:1 C420jpeg\n"
    with output.open("wb") as clip:
        clip.write(header.encode("ascii"))
        for yaw, pitch in POSES:
            frame = frame_bytes(person, yaw, pitch)
            for _ in range(FRAMES_PER_POSE):
                clip.write(frame)


def main(arguments: list[str]) -> int:
    if os.environ.get("APP_ENV") != "test":
        print("Refused: this script is only for the end-to-end tests (APP_ENV=test).")
        return 1
    if len(arguments) != 2 or not arguments[0].isdigit() or not 1 <= int(arguments[0]) <= 15:
        print("Usage: python -m app.scripts.e2e_face_video <person 1-15> <output.y4m>")
        return 2
    person, output = arguments
    write_clip(int(person), Path(output))
    print(f"Wrote {output}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
