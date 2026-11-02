"""Removes old phone sign-in data (M4b spec §7 rule 25). Safe to run again and again.

- `phone_proofs` rows older than 1 day: short "prove it is you" steps; the audit log keeps the
  outcome, and they hold no face data.
- Ended or run-out phone sign-ins older than 90 days: sign-in data, not attendance or audit
  records. A sign-in that a notice acceptance points to is KEPT: the acceptances are append-only
  and are the DPDP proof of what the employee agreed to (decision 0036 line 28). A sign-in that a
  punch points to is kept too: punches are never changed. A kept row loses its IP, browser,
  system and user agent (personal data), so only the dates and the employee stay.
  (`punches.ip` of a phone punch stays: the append-only trigger of `punches` refuses any change.)
Logs only counts, never what was deleted.
"""

from datetime import datetime, timedelta

from sqlalchemy import and_, delete, exists, or_, select, update
from sqlalchemy.orm import Session

from app.modules.phone.models import PhoneNoticeAcceptance, PhoneProof, PhoneSession
from app.modules.punches.models import Punch, PunchChallenge

PROOF_KEEP = timedelta(days=1)
SESSION_KEEP = timedelta(days=90)


def run_phone_cleanup(session: Session, now: datetime) -> dict[str, int]:
    proofs = session.execute(delete(PhoneProof).where(PhoneProof.issued_at < now - PROOF_KEEP))
    cutoff = now - SESSION_KEEP
    ended_long_ago = or_(
        PhoneSession.revoked_at < cutoff,
        and_(PhoneSession.revoked_at.is_(None), PhoneSession.expires_at < cutoff),
    )
    old_sessions = select(PhoneSession.id).where(
        ended_long_ago,
        ~exists().where(PhoneNoticeAcceptance.session_id == PhoneSession.id),
        ~exists().where(Punch.phone_session_id == PhoneSession.id),
    )
    removable = list(session.scalars(old_sessions))
    if removable:
        # Old phone challenges of these sign-ins go first (the 5-minute face cleanup removes
        # challenges after a day anyway).
        session.execute(
            delete(PunchChallenge).where(PunchChallenge.phone_session_id.in_(removable))
        )
        session.execute(delete(PhoneSession).where(PhoneSession.id.in_(removable)))
    scrubbed = session.execute(
        update(PhoneSession)
        .where(
            ended_long_ago,
            or_(
                PhoneSession.ip.is_not(None),
                PhoneSession.user_agent.is_not(None),
                PhoneSession.browser != "",
                PhoneSession.system != "",
            ),
        )
        .values(ip=None, user_agent=None, browser="", system="")
    )
    session.commit()
    return {
        "phone_proofs_deleted": proofs.rowcount,  # type: ignore[attr-defined]
        "phone_sessions_deleted": len(removable),
        "phone_sessions_scrubbed": scrubbed.rowcount,  # type: ignore[attr-defined]
    }
