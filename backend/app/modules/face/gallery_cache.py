"""The decrypted face templates of each plant, kept in memory for 1:N matching (spec M3 §7 rule 8).

Building a plant's gallery means decrypting its templates, so it is done once and reused. Every
service that changes who is in a gallery (enrol, delete, withdraw, mark as left, transfer, punch
method change) calls `invalidate_plant_gallery` after its change. Before each face punch a cheap
"stamp" query (how many templates, the latest template and employee change) is also compared,
which covers changes made by another server process. Decrypted templates live only here, in
memory: never on disk, in logs or in an answer.
"""

import logging
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime

import numpy as np
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.core.crypto import FaceDecryptionError, SealedVector, open_vector, template_binding
from app.face.embedder import EMBEDDING_SIZE
from app.face.matcher import Gallery
from app.modules.employees.models import Employee, EmployeeStatus, PunchMethod
from app.modules.face.models import FaceTemplate

logger = logging.getLogger(__name__)

Stamp = tuple[int, datetime | None, datetime | None]


@dataclass(frozen=True)
class _Entry:
    model_id: str
    stamp: Stamp
    gallery: Gallery


_lock = threading.Lock()
_galleries: dict[uuid.UUID, _Entry] = {}


def invalidate_plant_gallery(*plant_ids: uuid.UUID | None) -> None:
    with _lock:
        for plant_id in plant_ids:
            if plant_id is not None:
                _galleries.pop(plant_id, None)


def cached_plants() -> set[uuid.UUID]:
    """Which plants have a cached gallery (for tests and the health check)."""
    with _lock:
        return set(_galleries)


def remember_gallery(plant_id: uuid.UUID, gallery: object) -> None:
    """Tests only: pretend a plant has a cached gallery."""
    with _lock:
        _galleries[plant_id] = _Entry("", (0, None, None), gallery)  # type: ignore[arg-type]


def clear_all_galleries() -> None:
    with _lock:
        _galleries.clear()


def _gallery_members(plant_id: uuid.UUID, model_id: str):  # noqa: ANN202 (an SQL condition)
    return and_(
        FaceTemplate.deleted_at.is_(None),
        FaceTemplate.model_id == model_id,
        Employee.id == FaceTemplate.employee_id,
        Employee.plant_id == plant_id,
        Employee.status == EmployeeStatus.ACTIVE.value,
        Employee.punch_method == PunchMethod.FACE.value,
    )


def _stamp(session: Session, plant_id: uuid.UUID, model_id: str) -> Stamp:
    count, template_change = session.execute(
        select(func.count(FaceTemplate.id), func.max(FaceTemplate.updated_at)).where(
            _gallery_members(plant_id, model_id)
        )
    ).one()
    employee_change = session.scalar(
        select(func.max(Employee.updated_at)).where(Employee.plant_id == plant_id)
    )
    return int(count), template_change, employee_change


def plant_gallery(session: Session, plant_id: uuid.UUID, model_id: str, key: bytes) -> Gallery:
    """The plant's gallery from the cache, rebuilt when its stamp changed."""
    stamp = _stamp(session, plant_id, model_id)
    with _lock:
        entry = _galleries.get(plant_id)
    if entry is not None and entry.model_id == model_id and entry.stamp == stamp:
        return entry.gallery
    gallery = _build(session, plant_id, model_id, key)
    with _lock:
        _galleries[plant_id] = _Entry(model_id, stamp, gallery)
    return gallery


def _build(session: Session, plant_id: uuid.UUID, model_id: str, key: bytes) -> Gallery:
    rows = session.scalars(
        select(FaceTemplate).where(_gallery_members(plant_id, model_id)).order_by(FaceTemplate.id)
    ).all()
    employee_ids: list[uuid.UUID] = []
    vectors: list[np.ndarray] = []
    unreadable = 0
    for template in rows:
        if template.nonce is None or template.ciphertext is None:
            continue
        try:
            vectors.append(
                open_vector(
                    SealedVector(template.nonce, template.ciphertext),
                    template_binding(template.employee_id, template.model_id, template.key_id),
                    key,
                )
            )
        except FaceDecryptionError:
            unreadable += 1
            continue
        employee_ids.append(template.employee_id)
    if unreadable:
        # A wrong FACE_TEMPLATE_KEY: nobody of this plant can be matched (spec §9).
        logger.error(
            "Face templates cannot be decrypted (check FACE_TEMPLATE_KEY)",
            extra={"fields": {"plant_id": str(plant_id), "count": unreadable}},
        )
    if not vectors:
        return Gallery.empty()
    return Gallery(employee_ids, np.stack(vectors).reshape(len(vectors), EMBEDDING_SIZE))
