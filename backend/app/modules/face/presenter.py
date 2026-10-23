"""Turns face rows into API answers. Only names and dates: never ciphertext, nonce or scores."""

import uuid

from sqlalchemy.orm import Session

from app.modules.face.models import ConsentChoice, FaceConsent
from app.modules.face.schemas import ConsentView, PersonRef
from app.modules.users.models import User


def person(session: Session, user_id: uuid.UUID | None) -> PersonRef | None:
    if user_id is None:
        return None
    user = session.get(User, user_id)
    return PersonRef(id=user.id, name=user.name) if user else None


def consent_view(session: Session, consent: FaceConsent) -> ConsentView:
    return ConsentView(
        choice=ConsentChoice(consent.choice),
        text_version=consent.text_version,
        language=consent.language,
        explained_language=consent.explained_language,
        given_at=consent.given_at,
        recorded_by=person(session, consent.recorded_by),
        withdrawn_at=consent.withdrawn_at,
        withdrawn_by=person(session, consent.withdrawn_by),
        withdraw_kind=consent.withdraw_kind,
        withdraw_reason=consent.withdraw_reason,
    )
