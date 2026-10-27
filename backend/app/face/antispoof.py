"""How likely a face is a real, live face, not a printed photo or a screen (spec M3 §7 rule 6).

MiniFASNet (Silent-Face-Anti-Spoofing) looks at a crop around the face that is bigger than the
face itself (the "scale"), because the edges of a phone or a sheet of paper give a spoof away.
Each model answers 3 numbers; after softmax, number 1 is the chance that the face is real. With
two models (V2 at scale 2.7, V1SE at scale 4.0, as the original project) the chances are
averaged.
"""

from dataclasses import dataclass

import cv2
import numpy as np
import onnxruntime as ort

from app.face.detector import DetectedFace
from app.face.onnx_run import run_model

INPUT_SIZE = 80
REAL_CLASS = 1


@dataclass(frozen=True)
class AntiSpoofModel:
    session: ort.InferenceSession
    crop_scale: float

    def real_chance(self, picture: np.ndarray, face: DetectedFace) -> float:
        crop = _crop_around(picture, face, self.crop_scale)
        # These models take the BGR crop as plain 0-255 numbers (no scaling), as exported.
        blob = np.transpose(crop.astype(np.float32), (2, 0, 1))[None]
        logits = run_model(self.session, blob)[0][0]
        chances = np.exp(logits - logits.max())
        return float(chances[REAL_CLASS] / chances.sum())


class AntiSpoofChecker:
    def __init__(self, models: list[AntiSpoofModel]) -> None:
        if not models:
            raise ValueError("at least one anti-spoof model is needed")
        self.models = models

    def real_score(self, picture: np.ndarray, face: DetectedFace) -> float:
        """0-1: the average "real" chance of all models."""
        return sum(model.real_chance(picture, face) for model in self.models) / len(self.models)


def _crop_around(picture: np.ndarray, face: DetectedFace, crop_scale: float) -> np.ndarray:
    """A square-ish crop `crop_scale` times the face box, kept inside the picture."""
    picture_height, picture_width = picture.shape[:2]
    x1, y1, x2, y2 = face.box
    box_width, box_height = max(x2 - x1, 1.0), max(y2 - y1, 1.0)
    # Near the picture edge the crop cannot be as big as asked: use the biggest that fits.
    scale = min((picture_height - 1) / box_height, (picture_width - 1) / box_width, crop_scale)
    centre_x, centre_y = x1 + box_width / 2, y1 + box_height / 2
    half_width, half_height = box_width * scale / 2, box_height * scale / 2
    left = max(0, int(centre_x - half_width))
    top = max(0, int(centre_y - half_height))
    right = min(picture_width - 1, int(centre_x + half_width))
    bottom = min(picture_height - 1, int(centre_y + half_height))
    crop = picture[top : bottom + 1, left : right + 1]
    return cv2.resize(crop, (INPUT_SIZE, INPUT_SIZE))
