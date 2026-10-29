"""Rules for a face punch the gate saved offline (M4 spec §7 rule 10, decision 0025 item 2).

Offline the server could not choose the head turn, so the device chose it and signed it with the
punch. The server checks that it is a valid challenge for today's setting and that the pictures
follow it (face_liveness reads context.challenge), then runs the M3 frame, liveness, anti-spoof
and same-person checks. Instead of a 1:N search it compares the face with the ONE employee whose
code was typed (1:1), at any plant, so a match at another plant is WRONG_PLANT (photo kept).

This is weaker than online: someone who controls the gate device knows the turn in advance.
Recorded as an accepted risk (spec §8.3); every offline face punch keeps a photo for review.
"""

import uuid
from dataclasses import dataclass

import numpy as np

from app.antiproxy.context import RuleResult
from app.antiproxy.face_context import FacePunchContext
from app.face.matcher import cosine
from app.modules.employees.models import Employee

ONE_STEP_CHALLENGES = ("turn_left", "turn_right")
TWO_STEP_CHALLENGES = ("left_then_right", "right_then_left")


def check_offline_challenge(
    context: FacePunchContext, challenge: str | None, steps: int
) -> RuleResult:
    allowed = ONE_STEP_CHALLENGES if steps == 1 else TWO_STEP_CHALLENGES
    if challenge not in allowed:
        return RuleResult.rejected("OFFLINE_CHALLENGE_INVALID")
    context.challenge = challenge
    return RuleResult.passed()


@dataclass(frozen=True)
class CodeCandidate:
    """The employee whose code was typed, with their opened template (None when not enrolled)."""

    employee: Employee
    template: np.ndarray | None
    plant_id: uuid.UUID  # their plant at the punch time


def check_offline_code_match(
    context: FacePunchContext, candidate: CodeCandidate | None, threshold: float
) -> RuleResult:
    """1:1 against the typed code; one try only (the worker has left the gate long ago)."""
    if candidate is None or candidate.template is None or context.embedding is None:
        return RuleResult.rejected("FACE_NOT_RECOGNISED")
    score = cosine(context.embedding, candidate.template)
    context.code_score = score
    if score < threshold:
        return RuleResult.rejected("FACE_NOT_RECOGNISED")
    context.employee = candidate.employee
    if candidate.plant_id != context.kiosk.plant_id:
        return RuleResult.rejected("WRONG_PLANT")
    return RuleResult.passed()
