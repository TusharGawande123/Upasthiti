"""Cuts out a face and turns it upright, the way ArcFace was trained (112 × 112 pixels).

The 5 keypoints found by the detector are moved onto 5 fixed positions with one similarity
transform (move, turn and resize, no stretching). The fixed positions are the standard ArcFace
template used by InsightFace.
"""

import cv2
import numpy as np

ALIGNED_SIZE = 112
ARCFACE_TEMPLATE = np.array(
    [
        [38.2946, 51.6963],  # left eye (as seen in the picture)
        [73.5318, 51.5014],  # right eye
        [56.0252, 71.7366],  # nose tip
        [41.5493, 92.3655],  # left mouth corner
        [70.7299, 92.2041],  # right mouth corner
    ],
    dtype=np.float32,
)


class AlignmentError(Exception):
    """The keypoints do not allow a sensible transform (for example all on one spot)."""


def align_face(picture: np.ndarray, keypoints: np.ndarray) -> np.ndarray:
    """A 112 × 112 BGR face picture."""
    transform, _ = cv2.estimateAffinePartial2D(
        keypoints.astype(np.float32), ARCFACE_TEMPLATE, method=cv2.LMEDS
    )
    if transform is None:
        raise AlignmentError("no transform")
    return cv2.warpAffine(picture, transform, (ALIGNED_SIZE, ALIGNED_SIZE), borderValue=0)
