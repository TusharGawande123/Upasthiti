"""Card and employee facts as they were at an offline punch's time (M4 spec §7 rule 5, AC-16).

A punch saved offline at 08:20 and sent at 09:10 is judged as it was at 08:20 when its time is
proven (anchored): a card revoked at 08:30, a person marked as left that afternoon, or a transfer
dated tomorrow do not refuse it. When the time is NOT proven, everything is judged as it is at
sync (stricter), because the device could have chosen the time. Live punches are always judged
"now", which is their punch time anyway.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.modules.employees.models import Employee, EmployeePlantHistory, EmployeeStatus
from app.modules.qr_cards.models import QrCredential


def card_was_revoked(card: QrCredential, moment: datetime, at_punch_time: bool) -> bool:
    if card.revoked_at is None:
        return False
    return card.revoked_at <= moment if at_punch_time else True


def employee_was_active(employee: Employee, day: date, at_punch_time: bool) -> bool:
    if employee.status == EmployeeStatus.ACTIVE.value:
        return True
    # `left_on` is the last working day: a punch on or before it still belongs to the job.
    return at_punch_time and employee.left_on is not None and day <= employee.left_on


def employee_plant_on(
    session: Session, employee: Employee, day: date, at_punch_time: bool
) -> uuid.UUID:
    if not at_punch_time:
        return employee.plant_id
    plant_id = session.scalar(
        select(EmployeePlantHistory.plant_id)
        .where(
            EmployeePlantHistory.employee_id == employee.id,
            EmployeePlantHistory.from_date <= day,
            or_(EmployeePlantHistory.to_date.is_(None), EmployeePlantHistory.to_date >= day),
        )
        .order_by(EmployeePlantHistory.from_date.desc())
        .limit(1)
    )
    return plant_id or employee.plant_id
