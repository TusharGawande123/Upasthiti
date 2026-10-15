"""Plant scope: which plants a user may see or change for one capability.

Services use these helpers so a Plant Head never receives data of another plant, whatever
the browser asks for (spec §8 "plant scope is applied inside the service query").
"""

import uuid

from app.core.errors import ApiError
from app.modules.auth.dependencies import CurrentUser
from app.modules.auth.permissions import Access, Capability


def plant_filter(current_user: CurrentUser, capability: Capability) -> frozenset[uuid.UUID] | None:
    """None = every plant; otherwise the only plants the user may use."""
    access = current_user.access(capability)
    if access is None:
        raise ApiError("FORBIDDEN", "You are not allowed to do this.", 403)
    return current_user.plant_ids if access is Access.OWN_PLANT else None


def ensure_plant_in_scope(
    current_user: CurrentUser, capability: Capability, plant_id: uuid.UUID
) -> None:
    """A plant outside the user's scope looks like it does not exist (no id leaks)."""
    allowed = plant_filter(current_user, capability)
    if allowed is not None and plant_id not in allowed:
        raise ApiError("NOT_FOUND", "Not found.", 404)
