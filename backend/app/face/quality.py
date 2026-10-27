"""Picture quality and head pose from the detector's 5 keypoints (spec M3 §7 rules 4 and 5).

Head turn ("yaw") without a 3D model: the nose tip sticks out in front of the eyes. When the head
turns, the nose moves sideways in the picture more than the eyes do. With the eyes `d` apart and
the nose tip about `NOSE_DEPTH_RATIO × d` in front of them, a turn of angle `a` moves the nose
by `ratio × tan(a)` eye distances from the middle of the eyes. So
    yaw = atan(nose offset / NOSE_DEPTH_RATIO).

Sign: the frames are NOT mirrored. When a person turns to their own LEFT, their nose moves to the
RIGHT side of the picture (the camera faces them). We report yaw > 0 for a turn to the person's
own left and yaw < 0 for their own right. Tests with known pictures fix this sign.
"""

import math
from dataclasses import dataclass

import cv2
import numpy as np

from app.face.detector import DetectedFace

# Nose-tip depth in front of the eyes, as a share of the eye distance (adult average about 0.6).
# A rough value is enough: liveness needs a clear turn, not an exact angle.
NOSE_DEPTH_RATIO = 0.6

LEFT_EYE, RIGHT_EYE, NOSE, LEFT_MOUTH, RIGHT_MOUTH = range(5)


@dataclass(frozen=True)
class FaceQuality:
    face_px: float  # width of the face box in picture pixels
    sharpness: float  # variance of the Laplacian of the aligned face; low = blurry
    brightness: float  # 0-255, average of the face area


def estimate_yaw(keypoints: np.ndarray) -> float:
    """Degrees; > 0 = turned to the person's own left, < 0 = to their own right."""
    eye_middle_x = (keypoints[LEFT_EYE, 0] + keypoints[RIGHT_EYE, 0]) / 2
    eye_distance = float(np.linalg.norm(keypoints[RIGHT_EYE] - keypoints[LEFT_EYE]))
    if eye_distance < 1.0:
        return 0.0
    nose_offset = (keypoints[NOSE, 0] - eye_middle_x) / eye_distance
    return math.degrees(math.atan(nose_offset / NOSE_DEPTH_RATIO))


def nose_height_ratio(keypoints: np.ndarray) -> float:
    """Where the nose sits between the eyes (0) and the mouth (1).

    It falls when the chin is lifted and rises when the chin is lowered. Enrolment compares it
    with the straight shot of the same person, so no fixed angle is needed.
    """
    eye_middle_y = (keypoints[LEFT_EYE, 1] + keypoints[RIGHT_EYE, 1]) / 2
    mouth_middle_y = (keypoints[LEFT_MOUTH, 1] + keypoints[RIGHT_MOUTH, 1]) / 2
    span = mouth_middle_y - eye_middle_y
    if abs(span) < 1.0:
        return 0.5
    return float((keypoints[NOSE, 1] - eye_middle_y) / span)


def measure_quality(
    picture: np.ndarray, face: DetectedFace, aligned_face: np.ndarray
) -> FaceQuality:
    grey_face = cv2.cvtColor(aligned_face, cv2.COLOR_BGR2GRAY)
    sharpness = float(cv2.Laplacian(grey_face, cv2.CV_64F).var())

    height, width = picture.shape[:2]
    x1, y1, x2, y2 = (int(round(value)) for value in face.box)
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(width, x2), min(height, y2)
    area = picture[y1:y2, x1:x2]
    brightness = float(cv2.cvtColor(area, cv2.COLOR_BGR2GRAY).mean()) if area.size else 0.0
    return FaceQuality(face_px=face.width, sharpness=sharpness, brightness=brightness)
