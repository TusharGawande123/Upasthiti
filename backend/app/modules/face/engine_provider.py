"""The one face engine of this server process, the running model id and the face key (spec M3 §7
rules 9, 10, 17).

Endpoints get the engine through `get_face_engine` (a FastAPI dependency), so tests can swap in
a ready fake engine. The app's start-up starts loading it in the background (app/main.py).
"""

from functools import lru_cache

from app.core.config import Settings, get_settings
from app.core.crypto import decode_key
from app.core.errors import ApiError
from app.face.engine import FaceEngine, FaceServiceBusyError, FaceServiceUnavailableError
from app.face.fake_engine import FakeFaceModels
from app.face.models import OnnxFaceModels, RuntimeOptions, model_id_of, pack_files

FAKE_MODEL_ID = FakeFaceModels.model_id


def build_face_engine(settings: Settings) -> FaceEngine:
    if settings.effective_face_engine == "fake":
        return FaceEngine(FakeFaceModels)
    detector_file, recogniser_file = pack_files(settings.face_model_pack)
    pack_folder = settings.face_models_dir / settings.face_model_pack
    if not (pack_folder / detector_file).is_file() or not (pack_folder / recogniser_file).is_file():
        # No model files on this computer (for example a laptop without the download): face
        # recognition is simply "off"; card punches work as before.
        return FaceEngine(None)
    options = RuntimeOptions(detector_input_size=settings.face_detector_input)
    return FaceEngine(
        lambda: OnnxFaceModels(settings.face_models_dir, settings.face_model_pack, options=options)
    )


@lru_cache
def get_face_engine() -> FaceEngine:
    return build_face_engine(get_settings())


def running_model_id(settings: Settings | None = None) -> str:
    """Templates are compared only with embeddings of this model (spec §7 rule 9)."""
    settings = settings or get_settings()
    if settings.effective_face_engine == "fake":
        return FAKE_MODEL_ID
    return model_id_of(settings.face_model_pack)


def face_key() -> bytes:
    """The FACE_TEMPLATE_KEY bytes, or FACE_NOT_CONFIGURED (only possible outside production)."""
    key = get_settings().face_template_key
    if key is None:
        raise ApiError("FACE_NOT_CONFIGURED", "Face recognition is not set up on this server.", 503)
    return decode_key(key.get_secret_value())


def ready_engine(engine: FaceEngine) -> FaceEngine:
    """The engine, or FACE_SERVICE_UNAVAILABLE while it is loading or off."""
    if engine.model_id is None:
        raise ApiError(
            "FACE_SERVICE_UNAVAILABLE",
            "Face checks are not available right now. Try again in a minute.",
            503,
        )
    return engine


def ready_model_id(engine: FaceEngine) -> str:
    model_id = ready_engine(engine).model_id
    if model_id is None:  # ready_engine has refused this already; kept for the type checker
        raise ApiError("FACE_SERVICE_UNAVAILABLE", "Face checks are not available.", 503)
    return model_id


def run_face_job(engine: FaceEngine, job):  # noqa: ANN001, ANN201 (any job and its answer)
    """Run a job on the single face worker; busy or not loaded becomes the API error."""
    try:
        return engine.run(job)
    except FaceServiceBusyError:
        raise ApiError(
            "FACE_SERVICE_BUSY", "Many people are punching. Please try again in a moment.", 503
        ) from None
    except FaceServiceUnavailableError:
        raise ApiError(
            "FACE_SERVICE_UNAVAILABLE",
            "Face checks are not available right now. Try again in a minute.",
            503,
        ) from None


def engine_state(engine: FaceEngine) -> str:
    """ready / loading / off (a failed load is "off" for the gate)."""
    state = engine.state.value
    return state if state in ("ready", "loading") else "off"
