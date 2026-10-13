"""Which plants a user is limited to (a Plant Head has exactly one).

The `user_plant_access` table arrives with the plants (migration 0003). Until then no user
is limited to a plant, so this returns an empty list.
"""

import uuid

from sqlalchemy.orm import Session


def load_plant_ids(session: Session, user_id: uuid.UUID) -> list[uuid.UUID]:
    return []
