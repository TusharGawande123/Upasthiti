"""What the face rules read and write (spec M3 §7 rule 5).

Like PunchContext for cards: the endpoint fills in what the server trusts (clock, kiosk,
settings, the face models) and what the device sent (untrusted frames); each rule then adds
what it found (pictures, faces, turn, scores, the matched employee) for the rules after it.
"""

import uuid
from dataclasses import dataclass, field
from datetime import datetime

import numpy as np
from sqlalchemy.orm import Session

from app.face.detector import DetectedFace
from app.face.matcher import Gallery, MatchResult
from app.face.models import FaceModels
from app.modules.employees.models import Employee
from app.modules.kiosks.models import KioskDevice

FRONTAL, TURN = "frontal", "turn"


@dataclass(frozen=True)
class FaceLimits:
    """The face settings, read once per punch (the Super Admin edits them)."""

    match_threshold: float
    match_margin: float
    code_offer_floor: float
    consistency_threshold: float
    antispoof_threshold: float
    min_yaw_degrees: float
    frontal_max_yaw_degrees: float
    min_face_px: int
    blur_min: float
    brightness_min: float


@dataclass
class FaceFrame:
    role: str  # "frontal" or "turn"
    jpeg: bytes  # as sent (untrusted)
    picture: np.ndarray | None = None  # filled by face_frames
    face: DetectedFace | None = None
    aligned: np.ndarray | None = None
    yaw: float | None = None


@dataclass
class FacePunchContext:
    # What the server knows and trusts.
    session: Session
    kiosk: KioskDevice
    now: datetime  # taken when the request arrived, before waiting for the face worker
    limits: FaceLimits
    models: FaceModels
    gallery: Gallery
    # What the device sent (untrusted).
    challenge_nonce: str
    frames: list[FaceFrame]
    # What the rules find out, in order.
    challenge: str | None = None
    challenge_id: uuid.UUID | None = None
    yaw_degrees: float | None = None
    antispoof_score: float | None = None
    embedding: np.ndarray | None = None  # of the first frontal frame: used for matching
    match: MatchResult | None = None
    employee: Employee | None = None
    embeddings: list[np.ndarray] = field(default_factory=list)
    code_score: float | None = None  # M4 offline: the 1:1 score against the typed code

    @property
    def frontal_frames(self) -> list[FaceFrame]:
        return [frame for frame in self.frames if frame.role == FRONTAL]

    @property
    def turn_frames(self) -> list[FaceFrame]:
        return [frame for frame in self.frames if frame.role == TURN]
