"""Which plants a user is limited to (a Plant Head has exactly one; other roles none)."""

import uuid

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.modules.org.models import Plant, UserPlantAccess
from app.modules.users.models import User


def load_plant_ids(session: Session, user_id: uuid.UUID) -> list[uuid.UUID]:
    return list(
        session.scalars(select(UserPlantAccess.plant_id).where(UserPlantAccess.user_id == user_id))
    )


def set_user_plant(session: Session, user: User, plant_id: uuid.UUID | None) -> None:
    """Give the user exactly this plant (None = no plant). The caller commits."""
    if plant_id is not None:
        plant = session.get(Plant, plant_id)
        if plant is None or not plant.is_active:
            raise ApiError("PLANT_NOT_FOUND", "This plant does not exist.", 404)
    session.execute(delete(UserPlantAccess).where(UserPlantAccess.user_id == user.id))
    if plant_id is not None:
        session.add(UserPlantAccess(user_id=user.id, plant_id=plant_id))
    session.flush()
