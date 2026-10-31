"""Admin users: the three roles that log in (decision 0005). Employees are not users."""

import enum
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Index, String, Text, false, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.model_mixins import IdMixin, TimestampMixin


class Role(enum.StrEnum):
    SUPER_ADMIN = "super_admin"
    CORPORATE_HEAD = "corporate_head"
    PLANT_HEAD = "plant_head"


ROLE_VALUES = ", ".join(f"'{role.value}'" for role in Role)


class User(IdMixin, TimestampMixin, Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(f"role IN ({ROLE_VALUES})", name="role_known"),
        # Email is optional, but two users may never share one.
        Index(
            "uq_users_email_when_set",
            "email",
            unique=True,
            postgresql_where=text("email IS NOT NULL"),
        ),
    )

    name: Mapped[str] = mapped_column(String(120))
    username: Mapped[str] = mapped_column(String(30), unique=True)
    email: Mapped[str | None] = mapped_column(String(254))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20))
    is_active: Mapped[bool] = mapped_column(default=True)
    must_change_password: Mapped[bool] = mapped_column(default=True)
    # M5 (spec §7 rule 20): email alerts, used only when the server has SMTP settings.
    email_alerts_enabled: Mapped[bool] = mapped_column(default=False, server_default=false())
    email_alert_kinds: Mapped[list[str]] = mapped_column(
        ARRAY(Text), default=list, server_default=text("'{}'::text[]")
    )
    failed_login_count: Mapped[int] = mapped_column(default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
