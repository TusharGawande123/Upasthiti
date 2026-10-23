"""The decrypted face templates of each plant, kept in memory for 1:N matching (spec M3 §7 rule 8).

Building a plant's gallery means decrypting its templates, so it is done once and reused. Every
service that changes who is in a gallery (enrol, delete, withdraw, mark as left, transfer, punch
method change) calls `invalidate_plant_gallery` after its commit, so the next face punch at that
plant rebuilds it. The face punch (slice B) also compares a cheap database stamp before each
match, which covers changes made by another server process.
"""

import threading
import uuid
from typing import Any

_lock = threading.Lock()
_galleries: dict[uuid.UUID, Any] = {}  # plant id -> cached gallery (filled by the face punch)


def invalidate_plant_gallery(*plant_ids: uuid.UUID | None) -> None:
    with _lock:
        for plant_id in plant_ids:
            if plant_id is not None:
                _galleries.pop(plant_id, None)


def cached_plants() -> set[uuid.UUID]:
    """Which plants have a cached gallery (for tests and the health check)."""
    with _lock:
        return set(_galleries)


def remember_gallery(plant_id: uuid.UUID, gallery: Any) -> None:
    with _lock:
        _galleries[plant_id] = gallery


def clear_all_galleries() -> None:
    with _lock:
        _galleries.clear()
