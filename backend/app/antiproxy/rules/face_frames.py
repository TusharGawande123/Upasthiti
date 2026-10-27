"""Rule: every frame is a readable picture with exactly one usable face (spec M3 §7 rule 5.2).

People far behind (faces smaller than half of the main face) are ignored; two big faces are
refused. The frontal frames must also be sharp and bright enough to compare.
"""

from app.antiproxy.context import RuleResult
from app.antiproxy.face_context import FRONTAL, FacePunchContext
from app.face.images import ImageInvalidError, decode_jpeg
from app.face.quality import estimate_yaw

MAX_FRAME_BYTES = 70_000
MIN_DETECTOR_SCORE = 0.5
OTHER_FACE_SHARE = 0.5
REFERENCE_WIDTH = 640  # face_min_face_px is counted at this picture width


def check_frames(context: FacePunchContext) -> RuleResult:
    for frame in context.frames:
        if len(frame.jpeg) > MAX_FRAME_BYTES:
            return RuleResult.rejected("FRAMES_INVALID")
        try:
            frame.picture = decode_jpeg(
                frame.jpeg, min_width=320, max_width=640, min_height=240, max_height=480
            )
        except ImageInvalidError:
            return RuleResult.rejected("FRAMES_INVALID")

    limits = context.limits
    for frame in context.frames:
        if frame.picture is None:  # cannot happen: every frame was decoded above
            return RuleResult.rejected("FRAMES_INVALID")
        faces = [f for f in context.models.detect(frame.picture) if f.score >= MIN_DETECTOR_SCORE]
        if not faces:
            return RuleResult.rejected("NO_FACE")
        main = faces[0]
        if any(other.width >= main.width * OTHER_FACE_SHARE for other in faces[1:]):
            return RuleResult.rejected("MULTIPLE_FACES")
        if main.width < limits.min_face_px * frame.picture.shape[1] / REFERENCE_WIDTH:
            return RuleResult.rejected("FACE_TOO_SMALL")
        frame.face = main
        frame.aligned = context.models.align(frame.picture, main)
        frame.yaw = estimate_yaw(main.keypoints)
        if frame.role == FRONTAL:
            quality = context.models.quality(frame.picture, main, frame.aligned)
            if quality.sharpness < limits.blur_min or quality.brightness < limits.brightness_min:
                return RuleResult.rejected("FACE_QUALITY_LOW")
    return RuleResult.passed()
