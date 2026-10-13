"""Which plants a user is limited to (a Plant Head has exactly one).

The `user_plant_access` table arrives with the plants (migration 0003, slice B). Until then
no plant exists, so no user is limited to a plant and no plant can be assigned.
"""

import uuid

from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.modules.users.models import User


def load_plant_ids(session: Session, user_id: uuid.UUID) -> list[uuid.UUID]:
    return []


def set_user_plant(session: Session, user: User, plant_id: uuid.UUID | None) -> None:
    """Give the user exactly this plant (None = no plant). The caller commits."""
    if plant_id is None:
        return
    raise ApiError("PLANT_NOT_FOUND", "This plant does not exist.", 404)
