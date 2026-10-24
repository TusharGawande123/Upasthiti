"""Rule: the person turned their head the way the server asked (spec M3 §7 rule 5.3, F-43).

The turn is measured by the server from the detector's keypoints (app/face/quality.py: yaw > 0
is a turn to the person's OWN left; frames are not mirrored). A printed photo cannot turn, and a
recorded clip has only a 1 in 2 chance (1 in 4 with two steps) to turn the right way. The
device's own guidance (MediaPipe) is never used for this.
"""

from app.antiproxy.context import RuleResult
from app.antiproxy.face_context import FacePunchContext

# The direction(s) each challenge asks for, in order: +1 = own left, -1 = own right.
CHALLENGE_STEPS = {
    "turn_left": (1,),
    "turn_right": (-1,),
    "left_then_right": (1, -1),
    "right_then_left": (-1, 1),
}


def check_liveness(context: FacePunchContext) -> RuleResult:
    limits = context.limits
    for frame in context.frontal_frames:
        if frame.yaw is None or abs(frame.yaw) > limits.frontal_max_yaw_degrees:
            return RuleResult.rejected("LIVENESS_FAILED")

    steps = CHALLENGE_STEPS.get(context.challenge or "")
    turns = [frame.yaw for frame in context.turn_frames if frame.yaw is not None]
    # Exactly one turn frame per step, each turned the asked way, in the asked order. Extra
    # frames are refused: a clip (or a hand-made request) that sends a left and a right turn
    # would otherwise pass every challenge and the 1-in-2 chance would mean nothing.
    if steps is None or len(turns) != len(steps):
        return RuleResult.rejected("LIVENESS_FAILED")
    for yaw, direction in zip(turns, steps, strict=True):
        if yaw * direction < limits.min_yaw_degrees:
            return RuleResult.rejected("LIVENESS_FAILED")
    first_direction = steps[0]
    context.yaw_degrees = max(turns, key=lambda yaw: yaw * first_direction)
    return RuleResult.passed()
