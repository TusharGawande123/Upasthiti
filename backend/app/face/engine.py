"""The face engine of the running server: loads the models once and runs ONE face job at a time.

Why one at a time (spec M3 §7 rules 5 and 17): Render Free has 512 MB and 0.1 CPU. Two face
punches at once would only both be slow and could run the server out of memory. So a single
lock lets one job run; at most `max_waiting` requests may wait, each for at most
`max_wait_seconds`. Anyone else gets `FaceServiceBusyError` at once (the gate says "Many people
are punching. Please try again in a moment."), which is better than piling up.

Loading takes several seconds, so it happens in a background thread: the health check and card
punches answer at once, face requests get `FaceServiceUnavailableError` until the state is
`ready`. One warm-up run on a made-up picture makes the first real punch as fast as the rest.
"""

import enum
import logging
import threading
from collections.abc import Callable

import numpy as np

from app.face.detector import DetectedFace
from app.face.models import FaceModels

logger = logging.getLogger(__name__)


class EngineState(enum.StrEnum):
    OFF = "off"  # face recognition is not set up on this server
    LOADING = "loading"
    READY = "ready"
    FAILED = "failed"


class FaceServiceUnavailableError(Exception):
    """The models are not loaded (yet)."""


class FaceServiceBusyError(Exception):
    """Too many face requests are waiting already."""


class FaceEngine:
    def __init__(
        self,
        load_models: Callable[[], FaceModels] | None,
        *,
        max_waiting: int = 4,
        max_wait_seconds: float = 8.0,
    ) -> None:
        self._load_models = load_models
        self._models: FaceModels | None = None
        self.state = EngineState.OFF if load_models is None else EngineState.LOADING
        self.max_waiting = max_waiting
        self.max_wait_seconds = max_wait_seconds
        self._run_lock = threading.Lock()
        self._count_lock = threading.Lock()
        self._waiting = 0

    @property
    def model_pack(self) -> str | None:
        return self._models.model_pack if self._models else None

    @property
    def model_id(self) -> str | None:
        return self._models.model_id if self._models else None

    @property
    def antispoof_id(self) -> str | None:
        return self._models.antispoof_id if self._models else None

    def start_loading(self) -> threading.Thread | None:
        if self._load_models is None:
            return None
        thread = threading.Thread(target=self.load_now, name="face-engine-load", daemon=True)
        thread.start()
        return thread

    def load_now(self) -> None:
        """Load and warm up (in the calling thread). Sets the state to ready or failed."""
        if self._load_models is None:
            return
        try:
            models = self._load_models()
            warm_up(models)
        except Exception as error:  # any failure: face is off, card punches go on
            # Only the error type: a message could carry a file path.
            logger.error(
                "Face engine failed to load", extra={"fields": {"error": type(error).__name__}}
            )
            self.state = EngineState.FAILED
            return
        self._models = models
        self.state = EngineState.READY

    def run[T](self, job: Callable[[FaceModels], T]) -> T:
        """Run one face job with the models, waiting for the single worker slot."""
        models = self._models
        if self.state is not EngineState.READY or models is None:
            raise FaceServiceUnavailableError
        with self._count_lock:
            if self._waiting >= self.max_waiting:
                raise FaceServiceBusyError
            self._waiting += 1
        got_slot = self._run_lock.acquire(timeout=self.max_wait_seconds)
        with self._count_lock:
            self._waiting -= 1
        if not got_slot:
            raise FaceServiceBusyError
        try:
            return job(models)
        finally:
            self._run_lock.release()

    def try_run[T](self, job: Callable[[FaceModels], T]) -> T | None:
        """Run only if the worker is free right now; else None (for background extras, F-30)."""
        models = self._models
        if self.state is not EngineState.READY or models is None:
            return None
        if not self._run_lock.acquire(blocking=False):
            return None
        try:
            return job(models)
        finally:
            self._run_lock.release()


def warm_up(models: FaceModels) -> None:
    """One run of every model on a made-up picture (no person), so the first punch is not slow."""
    rng = np.random.default_rng(0)
    picture = rng.integers(0, 255, size=(480, 640, 3), dtype=np.uint8)
    models.detect(picture)
    face = DetectedFace(
        box=(220.0, 140.0, 420.0, 340.0),
        score=1.0,
        keypoints=np.array(
            [[280, 210], [360, 210], [320, 250], [290, 290], [350, 290]], dtype=np.float32
        ),
    )
    aligned = models.align(picture, face)
    models.embed(aligned)
    models.real_score(picture, face)
