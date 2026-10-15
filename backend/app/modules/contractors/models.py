"""Contractors: companies that supply operators and helpers (one company-wide list)."""

from sqlalchemy import Index, String, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.model_mixins import IdMixin, TimestampMixin


class Contractor(IdMixin, TimestampMixin, Base):
    __tablename__ = "contractors"
    __table_args__ = (Index("uq_contractors_name", func.lower(text("name")), unique=True),)

    name: Mapped[str] = mapped_column(String(120))
    contact_name: Mapped[str | None] = mapped_column(String(120))
    contact_phone: Mapped[str | None] = mapped_column(String(20))
    is_active: Mapped[bool] = mapped_column(default=True)
