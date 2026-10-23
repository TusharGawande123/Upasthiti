"""Rule: whose face is it? 1:N against the kiosk plant's gallery (spec M3 §7 rule 7).

Matched: the employee is known and the IN/OUT rule runs next. Unsure (close, but not sure
enough, e.g. twins): NEED_EMPLOYEE_CODE, and the gate asks for the code. Not recognised:
FACE_NOT_RECOGNISED. Only employees of THIS plant are in the gallery: matching every plant
would raise the chance of a stranger being accepted seven times.
"""

from app.antiproxy.context import RuleResult
from app.antiproxy.face_context import FacePunchContext
from app.face.matcher import MatchKind, MatchThresholds, match_one_to_many
from app.modules.employees.models import Employee


def check_match(context: FacePunchContext) -> RuleResult:
    if context.embedding is None:
        return RuleResult.rejected("FACE_NOT_RECOGNISED")
    limits = context.limits
    result = match_one_to_many(
        context.embedding,
        context.gallery,
        MatchThresholds(
            match=limits.match_threshold,
            margin=limits.match_margin,
            code_offer_floor=limits.code_offer_floor,
        ),
    )
    context.match = result
    if result.kind is MatchKind.UNSURE:
        return RuleResult.rejected("NEED_EMPLOYEE_CODE")
    if result.kind is MatchKind.NO_MATCH or result.employee_id is None:
        return RuleResult.rejected("FACE_NOT_RECOGNISED")
    context.employee = context.session.get(Employee, result.employee_id)
    if context.employee is None:
        return RuleResult.rejected("FACE_NOT_RECOGNISED")
    return RuleResult.passed()
