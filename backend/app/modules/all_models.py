"""Imports every table model, so Alembic and SQLAlchemy know all tables.

Add a line here whenever a module gets a models.py.
"""

from app.modules.audit import models as audit_models
from app.modules.auth import models as auth_models
from app.modules.org import models as org_models
from app.modules.settings import models as settings_models
from app.modules.users import models as users_models

__all__ = ["audit_models", "auth_models", "org_models", "settings_models", "users_models"]
