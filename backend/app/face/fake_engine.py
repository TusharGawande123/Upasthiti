"""A stand-in for the face models, for tests and end-to-end runs (FACE_ENGINE=fake, test only).

It never looks at a real face. Instead, three grey squares in the top-left corner of a test
picture say what the "camera saw" (grey survives JPEG compression well):
  square 1 (x 0-15):  which person (1-15; 0 = no face in the picture)
  square 2 (x 16-31): head turn in degrees (grey 128 = straight, +2 per degree to the left)
  square 3 (x 32-47): a problem to pretend (see Problem)
`make_fake_frame` paints such a picture. Every person gets a fixed random embedding, so the
matcher, the rules and the code path behave as with real faces.
"""

import enum
import math

import cv2
import numpy as np

from app.face.detector import DetectedFace
from app.face.embedder import EMBEDDING_SIZE, normalise
from app.face.quality import NOSE_DEPTH_RATIO, FaceQuality

SQUARE = 16
NORMAL_FACE_PX = 240
SMALL_FACE_PX = 60


class Problem(enum.IntEnum):
    NONE = 0
    TWO_FACES = 1
    SPOOF = 2
    SMALL_FACE = 3
    BLURRY = 4
    DARK = 5


# Made-up people whose face is "between" others, to test the unsure path:
# 14 looks equally like 1 and 2 (twins: no margin); 13 looks only a little like 3 (low score).
MIXED_PEOPLE = {14: ((1, 0.5), (2, 0.5)), 13: ((3, 0.38), (99, 0.925))}


def fake_embedding(person: int) -> np.ndarray:
    if person in MIXED_PEOPLE:
        mixed = sum(weight * fake_embedding(part) for part, weight in MIXED_PEOPLE[person])
        return normalise(np.asarray(mixed, dtype=np.float32))
    rng = np.random.default_rng(1000 + person)
    return normalise(rng.standard_normal(EMBEDDING_SIZE).astype(np.float32))


def make_fake_frame(
    person: int,
    yaw_degrees: float = 0.0,
    problem: Problem = Problem.NONE,
    width: int = 640,
    height: int = 480,
) -> bytes:
    """A JPEG test picture that the fake engine reads as `person` with this head turn."""
    picture = np.full((height, width, 3), 150, dtype=np.uint8)
    for index, grey in enumerate((16 * person + 8, 128 + 2 * yaw_degrees, 16 * problem + 8)):
        picture[:SQUARE, index * SQUARE : (index + 1) * SQUARE] = int(round(grey))
    ok, encoded = cv2.imencode(".jpg", picture, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not ok:
        raise RuntimeError("could not encode the test picture")
    return encoded.tobytes()


def _read_square(picture: np.ndarray, index: int) -> float:
    square = picture[2 : SQUARE - 2, index * SQUARE + 2 : (index + 1) * SQUARE - 2]
    return float(np.median(square))


def read_marks(picture: np.ndarray) -> tuple[int, float, Problem]:
    person = int(round((_read_square(picture, 0) - 8) / 16))
    yaw = (_read_square(picture, 1) - 128) / 2
    problem = Problem(min(int(round((_read_square(picture, 2) - 8) / 16)), max(Problem)))
    return person, yaw, problem


def fake_keypoints(centre_x: float, centre_y: float, face_px: float, yaw: float) -> np.ndarray:
    """Keypoints that quality.estimate_yaw reads back as `yaw` degrees."""
    eye_distance = face_px * 0.4
    nose_x = centre_x + eye_distance * NOSE_DEPTH_RATIO * math.tan(math.radians(yaw))
    return np.array(
        [
            [centre_x - eye_distance / 2, centre_y - face_px * 0.15],
            [centre_x + eye_distance / 2, centre_y - face_px * 0.15],
            [nose_x, centre_y + face_px * 0.05],
            [centre_x - eye_distance * 0.4, centre_y + face_px * 0.25],
            [centre_x + eye_distance * 0.4, centre_y + face_px * 0.25],
        ],
        dtype=np.float32,
    )


def _face_at(centre_x: float, centre_y: float, face_px: float, yaw: float) -> DetectedFace:
    half = face_px / 2
    return DetectedFace(
        box=(centre_x - half, centre_y - half, centre_x + half, centre_y + half),
        score=0.9,
        keypoints=fake_keypoints(centre_x, centre_y, face_px, yaw),
    )


class FakeFaceModels:
    model_pack = "fake"
    model_id = "fake/fake"
    antispoof_id = "fake"

    def detect(self, picture: np.ndarray) -> list[DetectedFace]:
        person, yaw, problem = read_marks(picture)
        if person <= 0:
            return []
        height, width = picture.shape[:2]
        face_px = SMALL_FACE_PX if problem is Problem.SMALL_FACE else NORMAL_FACE_PX
        if problem is Problem.TWO_FACES:
            return [
                _face_at(width * 0.3, height / 2, face_px, yaw),
                _face_at(width * 0.7, height / 2, face_px, yaw),
            ]
        return [_face_at(width / 2, height / 2, face_px, yaw)]

    def align(self, picture: np.ndarray, face: DetectedFace) -> np.ndarray:
        # The "aligned face" carries the marks, so embed() knows whose face it is.
        aligned = np.zeros((112, 112, 3), dtype=np.uint8)
        aligned[:SQUARE, : 3 * SQUARE] = picture[:SQUARE, : 3 * SQUARE]
        return aligned

    def embed(self, aligned_face: np.ndarray) -> np.ndarray:
        person, _, _ = read_marks(aligned_face)
        return fake_embedding(person)

    def real_score(self, picture: np.ndarray, face: DetectedFace) -> float:
        _, _, problem = read_marks(picture)
        return 0.1 if problem is Problem.SPOOF else 0.97

    def quality(
        self, picture: np.ndarray, face: DetectedFace, aligned_face: np.ndarray
    ) -> FaceQuality:
        _, _, problem = read_marks(picture)
        return FaceQuality(
            face_px=face.width,
            sharpness=5.0 if problem is Problem.BLURRY else 200.0,
            brightness=20.0 if problem is Problem.DARK else 140.0,
        )
