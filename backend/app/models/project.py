from __future__ import annotations

import enum
import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, IdMixin, TimestampMixin, str_enum


class Project(IdMixin, TimestampMixin, Base):
    __tablename__ = "projects"

    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")

    tasks: Mapped[list[ProjectTask]] = relationship(back_populates="project")


class ProjectTask(IdMixin, TimestampMixin, Base):
    __tablename__ = "project_tasks"
    __table_args__ = (
        UniqueConstraint("project_id", "code", name="uq_project_tasks_project_id_code"),
        # Target of the composite FK from time_entries (project_id, task_id).
        UniqueConstraint("project_id", "id", name="uq_project_tasks_project_id_id"),
        Index("ix_project_tasks_project_id_is_active", "project_id", "is_active"),
    )

    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="RESTRICT"), nullable=False
    )
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")

    project: Mapped[Project] = relationship(back_populates="tasks")


class Classification(enum.StrEnum):
    CAPPED = "CAPPED"
    NON_CAPPED = "NON_CAPPED"


class EarningCode(IdMixin, TimestampMixin, Base):
    __tablename__ = "earning_codes"
    __table_args__ = (CheckConstraint("char_length(trim(code)) > 0", name="code_not_blank"),)

    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    classification: Mapped[Classification] = mapped_column(
        str_enum(Classification, "classification"), nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
