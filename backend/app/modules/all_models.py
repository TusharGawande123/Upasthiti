"""Imports every table model, so Alembic and SQLAlchemy know all tables.

Add a line here whenever a module gets a models.py.
"""

from app.modules.approvals import models as approvals_models
from app.modules.attendance import models as attendance_models
from app.modules.audit import models as audit_models
from app.modules.auth import models as auth_models
from app.modules.contractors import models as contractors_models
from app.modules.employees import models as employees_models
from app.modules.face import models as face_models
from app.modules.holidays import models as holidays_models
from app.modules.kiosks import models as kiosks_models
from app.modules.leave import models as leave_models
from app.modules.notices import models as notices_models
from app.modules.notifications import models as notifications_models
from app.modules.org import models as org_models
from app.modules.punches import models as punches_models
from app.modules.qr_cards import models as qr_cards_models
from app.modules.regularisations import models as regularisations_models
from app.modules.settings import models as settings_models
from app.modules.users import models as users_models

__all__ = [
    "approvals_models",
    "attendance_models",
    "audit_models",
    "auth_models",
    "contractors_models",
    "employees_models",
    "face_models",
    "holidays_models",
    "kiosks_models",
    "leave_models",
    "notices_models",
    "notifications_models",
    "org_models",
    "punches_models",
    "qr_cards_models",
    "regularisations_models",
    "settings_models",
    "users_models",
]
