"""Rule: the head-turn challenge must be this kiosk's, unused and not too old (spec M3 §7 rule 5.1).

One UPDATE marks it used only if all of that holds, so two requests with the same nonce can
never both pass. A used challenge stays used even if a later rule refuses the punch.
"""

import hashlib

from sqlalchemy import select, update

from app.antiproxy.context import RuleResult
from app.antiproxy.face_context import FacePunchContext
from app.modules.punches.models import PunchChallenge


def nonce_hash(nonce: str) -> str:
    return hashlib.sha256(nonce.encode("utf-8")).hexdigest()


def check_challenge(context: FacePunchContext) -> RuleResult:
    digest = nonce_hash(context.challenge_nonce)
    used = context.session.execute(
        update(PunchChallenge)
        .where(
            PunchChallenge.nonce_sha256 == digest,
            PunchChallenge.kiosk_id == context.kiosk.id,
            PunchChallenge.used_at.is_(None),
            PunchChallenge.expires_at >= context.now,
        )
        .values(used_at=context.now)
        .returning(PunchChallenge.id, PunchChallenge.challenge)
    ).first()
    if used is not None:
        context.challenge_id, context.challenge = used
        return RuleResult.passed()

    # Why not? An expired challenge of this kiosk gets its own answer ("Too slow").
    expired = context.session.scalar(
        select(PunchChallenge.id).where(
            PunchChallenge.nonce_sha256 == digest,
            PunchChallenge.kiosk_id == context.kiosk.id,
            PunchChallenge.used_at.is_(None),
        )
    )
    if expired is not None:
        context.session.execute(
            update(PunchChallenge).where(PunchChallenge.id == expired).values(used_at=context.now)
        )
        return RuleResult.rejected("CHALLENGE_EXPIRED")
    return RuleResult.rejected("CHALLENGE_INVALID")
