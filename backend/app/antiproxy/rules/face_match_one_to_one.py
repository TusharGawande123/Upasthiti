"""Rule: is it the signed-in employee's face? 1:1 against their own template (M4b spec §7 rule 10).

A phone punch knows who the person claims to be (the employee signed in), so the face is compared
with that one template only: no gallery search, no employee-code fallback, no "unsure" answer. The
stricter gate threshold `face_match_threshold` applies. A face that does not reach it, and a missing
template, both give FACE_NOT_RECOGNISED (the phone then shows the same refusal).
"""

from app.antiproxy.context import RuleResult
from app.antiproxy.face_context import FacePunchContext
from app.face.matcher import cosine


def check_match_one_to_one(context: FacePunchContext) -> RuleResult:
    if context.embedding is None or context.own_template is None:
        return RuleResult.rejected("FACE_NOT_RECOGNISED")
    score = cosine(context.embedding, context.own_template)
    context.one_to_one_score = score
    if score < context.limits.match_threshold or context.expected_employee is None:
        return RuleResult.rejected("FACE_NOT_RECOGNISED")
    context.employee = context.expected_employee
    return RuleResult.passed()
