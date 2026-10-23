"""Rule: every frame shows the same person (spec M3 §7 rule 5.5).

Stops a swap between frames: for example a real person doing the turn while a photo of
someone else fills the frontal frame. Embeddings of the first frontal frame, the strongest
turn frame and a second frontal frame (if sent) must all be alike.
"""

from itertools import combinations

from app.antiproxy.context import RuleResult
from app.antiproxy.face_context import FaceFrame, FacePunchContext
from app.face.matcher import cosine


def check_consistency(context: FacePunchContext) -> RuleResult:
    frontal = context.frontal_frames
    chosen: list[FaceFrame] = [frontal[0]]
    turn = _strongest_turn(context)
    if turn is not None:
        chosen.append(turn)
    if len(frontal) > 1:
        chosen.append(frontal[1])

    embeddings = [
        context.models.embed(frame.aligned) for frame in chosen if frame.aligned is not None
    ]
    context.embeddings = embeddings
    context.embedding = embeddings[0] if embeddings else None
    for first, second in combinations(embeddings, 2):
        if cosine(first, second) < context.limits.consistency_threshold:
            return RuleResult.rejected("FACE_INCONSISTENT")
    if context.embedding is None:
        return RuleResult.rejected("FACE_INCONSISTENT")
    return RuleResult.passed()


def _strongest_turn(context: FacePunchContext) -> FaceFrame | None:
    turns = [frame for frame in context.turn_frames if frame.yaw is not None]
    return max(turns, key=lambda frame: abs(frame.yaw or 0.0)) if turns else None
