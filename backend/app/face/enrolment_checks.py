"""The server's checks of one enrolment shot, in the order of spec M3 §7 rule 4.

The first check that fails gives the reason the Super Admin sees ("The picture is blurry. Hold
still."). Only an accepted shot gives an embedding; the picture itself is never kept. Pure code:
the models come in, the database stays outside.
"""

from dataclasses import dataclass

import numpy as np

from app.face.images import ImageInvalidError, decode_jpeg
from app.face.matcher import cosine
from app.face.models import FaceModels
from app.face.quality import estimate_yaw, nose_height_ratio

MIN_DETECTOR_SCORE = 0.6
# Faces smaller than half of the biggest one are people far behind: ignored.
OTHER_FACE_SHARE = 0.5
# Enrolment wants a bigger face than the gate (spec: face_min_face_px × 1.5).
ENROLMENT_SIZE_FACTOR = 1.5
REFERENCE_WIDTH = 640  # face_min_face_px is counted at this picture width
MAX_BRIGHTNESS = 230
STRAIGHT_MAX_YAW = 12.0
TURN_MIN_YAW = 8.0
TURN_MAX_YAW = 30.0
# "Chin up / down": the nose must move this share of the eye-to-mouth distance.
PITCH_CHANGE = 0.06
STRAIGHT_POSES = ("straight", "closer", "farther", "work_wear")
SHOT_MIN_WIDTH, SHOT_MAX_WIDTH = 480, 1280
SHOT_MIN_HEIGHT, SHOT_MAX_HEIGHT = 360, 1600


@dataclass(frozen=True)
class ShotLimits:
    min_face_px: int
    blur_min: float
    brightness_min: float
    antispoof_threshold: float
    consistency_threshold: float


@dataclass(frozen=True)
class ShotQuality:
    face_px: float
    sharpness: float
    brightness: float
    yaw: float
    pitch: float  # the nose height ratio (0 = at the eyes, 1 = at the mouth)


@dataclass(frozen=True)
class ShotResult:
    reason_code: str | None  # None = accepted
    embedding: np.ndarray | None = None
    quality: ShotQuality | None = None

    @property
    def accepted(self) -> bool:
        return self.reason_code is None


def check_shot(
    models: FaceModels,
    jpeg: bytes,
    pose: str,
    limits: ShotLimits,
    *,
    straight_embedding: np.ndarray | None,
    straight_nose_ratio: float | None,
) -> ShotResult:
    try:
        picture = decode_jpeg(
            jpeg,
            min_width=SHOT_MIN_WIDTH,
            max_width=SHOT_MAX_WIDTH,
            min_height=SHOT_MIN_HEIGHT,
            max_height=SHOT_MAX_HEIGHT,
        )
    except ImageInvalidError:
        return ShotResult("ENROL_IMAGE_INVALID")

    faces = [face for face in models.detect(picture) if face.score >= MIN_DETECTOR_SCORE]
    if not faces:
        return ShotResult("ENROL_NO_FACE")
    face = faces[0]  # the biggest
    if any(other.width >= face.width * OTHER_FACE_SHARE for other in faces[1:]):
        return ShotResult("ENROL_MULTIPLE_FACES")

    aligned = models.align(picture, face)
    measured = models.quality(picture, face, aligned)
    quality = ShotQuality(
        face_px=measured.face_px,
        sharpness=measured.sharpness,
        brightness=measured.brightness,
        yaw=estimate_yaw(face.keypoints),
        pitch=nose_height_ratio(face.keypoints),
    )
    needed_px = limits.min_face_px * ENROLMENT_SIZE_FACTOR * picture.shape[1] / REFERENCE_WIDTH
    if quality.face_px < needed_px:
        return ShotResult("ENROL_FACE_TOO_SMALL", quality=quality)
    if quality.sharpness < limits.blur_min:
        return ShotResult("ENROL_BLURRY", quality=quality)
    if quality.brightness < limits.brightness_min:
        return ShotResult("ENROL_TOO_DARK", quality=quality)
    if quality.brightness > MAX_BRIGHTNESS:
        return ShotResult("ENROL_TOO_BRIGHT", quality=quality)
    if not pose_matches(pose, quality, straight_nose_ratio):
        return ShotResult("ENROL_POSE_WRONG", quality=quality)
    if models.real_score(picture, face) < limits.antispoof_threshold:
        return ShotResult("ENROL_SPOOF_SUSPECTED", quality=quality)

    embedding = models.embed(aligned)
    if straight_embedding is not None and (
        cosine(embedding, straight_embedding) < limits.consistency_threshold
    ):
        return ShotResult("ENROL_NOT_SAME_PERSON", quality=quality)
    return ShotResult(None, embedding=embedding, quality=quality)


def pose_matches(pose: str, quality: ShotQuality, straight_nose_ratio: float | None) -> bool:
    """Left and right are the person's own (yaw > 0 = own left, see quality.py)."""
    if pose in STRAIGHT_POSES:
        return abs(quality.yaw) <= STRAIGHT_MAX_YAW
    if pose == "left":
        return TURN_MIN_YAW <= quality.yaw <= TURN_MAX_YAW
    if pose == "right":
        return -TURN_MAX_YAW <= quality.yaw <= -TURN_MIN_YAW
    if straight_nose_ratio is None or abs(quality.yaw) > STRAIGHT_MAX_YAW:
        return False
    if pose == "up":  # chin lifted: the nose moves up, towards the eyes
        return quality.pitch <= straight_nose_ratio - PITCH_CHANGE
    if pose == "down":
        return quality.pitch >= straight_nose_ratio + PITCH_CHANGE
    return False
