"""Administrator-managed configuration and its audit trail."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, IdMixin, str_enum


class PolicySetting(Base):
    """The single row of hour/description policy that overrides the environment defaults."""

    __tablename__ = "policy_settings"
    __table_args__ = (
        CheckConstraint("id = 1", name="singleton"),
        CheckConstraint(
            "max_hours_per_entry > 0 AND max_hours_per_entry <= 24", name="entry_range"
        ),
        CheckConstraint(
            "max_hours_per_day IS NULL OR (max_hours_per_day > 0 AND max_hours_per_day <= 24)",
            name="day_range",
        ),
        CheckConstraint(
            "max_hours_per_week IS NULL OR (max_hours_per_week > 0 AND max_hours_per_week <= 168)",
            name="week_range",
        ),
        CheckConstraint(
            "max_hours_per_day IS NULL OR max_hours_per_week IS NULL "
            "OR max_hours_per_week >= max_hours_per_day",
            name="week_not_below_day",
        ),
        CheckConstraint("description_max_length BETWEEN 1 AND 256", name="description_range"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    max_hours_per_entry: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    max_hours_per_day: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    max_hours_per_week: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    description_max_length: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_by: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class ConfigEntity(enum.StrEnum):
    USER = "USER"
    TEAM = "TEAM"
    PROJECT = "PROJECT"
    TASK = "TASK"
    EARNING_CODE = "EARNING_CODE"
    POLICY = "POLICY"


class ConfigAction(enum.StrEnum):
    CREATED = "CREATED"
    UPDATED = "UPDATED"
    DEACTIVATED = "DEACTIVATED"
    REACTIVATED = "REACTIVATED"
    DELETED = "DELETED"
    PASSWORD_RESET = "PASSWORD_RESET"  # noqa: S105 - an action name, not a credential
    MEMBERS_CHANGED = "MEMBERS_CHANGED"


class ConfigAuditEvent(IdMixin, Base):
    """Append-only record of every administrator change (never contains secrets).

    ``details`` holds a human label for the entity plus the changed fields as
    ``{field: {from, to}}`` so the entry stays readable after the entity is renamed or removed.
    """

    __tablename__ = "config_audit_events"
    __table_args__ = (
        Index("ix_config_audit_events_created_at", "created_at"),
        Index("ix_config_audit_events_entity", "entity_type", "entity_id"),
    )

    actor_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    entity_type: Mapped[ConfigEntity] = mapped_column(
        str_enum(ConfigEntity, "entity_type"), nullable=False
    )
    entity_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    action: Mapped[ConfigAction] = mapped_column(str_enum(ConfigAction, "action"), nullable=False)
    details: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
