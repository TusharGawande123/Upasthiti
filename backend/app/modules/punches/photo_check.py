"""F-30: after a card punch, look whether a face is on its photo (spec M3 §7 rule 16).

It runs as a background task after the answer was sent, so it never changes the decision, the
punch row or the answer time. It only runs the face detector, and only when the face worker
is free at that moment: when the engine is busy or off, `face_found` simply stays NULL ("not
checked"). The photo bytes are the ones still in memory; nothing is decrypted or stored.
"""

import logging
import uuid
from collections.abc import Callable
from contextlib import AbstractContextManager

from sqlalchemy.orm import Session

from app.core.db import get_session_factory
from app.face.engine import FaceEngine
from app.face.images import ImageInvalidError, decode_jpeg
from app.face.models import FaceModels
from app.modules.punches.models import PunchSnapshot

logger = logging.getLogger(__name__)

SessionMaker = Callable[[], AbstractContextManager[Session]]
MIN_DETECTOR_SCORE = 0.5


def get_task_sessions() -> SessionMaker:
    """Background tasks open their own database session (a dependency, so tests can swap it)."""
    return get_session_factory()


def check_face_in_photo(
    snapshot_id: uuid.UUID, jpeg: bytes, engine: FaceEngine, sessions: SessionMaker
) -> None:
    def has_face(models: FaceModels) -> bool:
        picture = decode_jpeg(jpeg, min_width=1, max_width=1280, min_height=1, max_height=1280)
        return any(face.score >= MIN_DETECTOR_SCORE for face in models.detect(picture))

    try:
        found = engine.try_run(has_face)
    except ImageInvalidError:
        return
    if found is None:  # the face worker was busy or face recognition is off
        return
    try:
        with sessions() as session:
            snapshot = session.get(PunchSnapshot, snapshot_id)
            if snapshot is not None:
                snapshot.face_found = found
                session.commit()
    except Exception:  # a background extra must never disturb the gate
        logger.exception("Face-in-photo check could not be saved")
