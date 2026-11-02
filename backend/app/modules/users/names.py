"""Looking up the display names of users (who asked, who decided) in one query."""

import uuid
from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.users.models import User


def user_names(
    session: Session, user_ids: Iterable[uuid.UUID] | None = None
) -> dict[uuid.UUID, str]:
    """`{user id: name}` for the given users, or for everybody when no ids are given."""
    statement = select(User.id, User.name)
    if user_ids is not None:
        statement = statement.where(User.id.in_(set(user_ids)))
    return dict(session.execute(statement).all())
