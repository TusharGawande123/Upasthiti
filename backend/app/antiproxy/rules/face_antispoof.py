"""Rule: the frontal frames look like a live face, not a photo or a screen (spec M3 §7 rule 5.4).

A replayed video can show a head turn, so this check is the main defence against it. The
lowest "real" score of the frontal frames must reach `face_antispoof_threshold`.
"""

from app.antiproxy.context import RuleResult
from app.antiproxy.face_context import FacePunchContext


def check_antispoof(context: FacePunchContext) -> RuleResult:
    scores = [
        context.models.real_score(frame.picture, frame.face)
        for frame in context.frontal_frames
        if frame.picture is not None and frame.face is not None
    ]
    if not scores:
        return RuleResult.rejected("SPOOF_SUSPECTED")
    context.antispoof_score = min(scores)
    if context.antispoof_score < context.limits.antispoof_threshold:
        return RuleResult.rejected("SPOOF_SUSPECTED")
    return RuleResult.passed()
