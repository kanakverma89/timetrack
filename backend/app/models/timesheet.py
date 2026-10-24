from __future__ import annotations

import enum
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, IdMixin, TimestampMixin, str_enum
from app.models.project import EarningCode, Project, ProjectTask


class WeekStatus(enum.StrEnum):
    DRAFT = "DRAFT"
    SUBMITTED = "SUBMITTED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class TimesheetWeek(IdMixin, TimestampMixin, Base):
    __tablename__ = "timesheet_weeks"
    __table_args__ = (
        UniqueConstraint("employee_id", "week_start_date", name="uq_timesheet_weeks_employee_week"),
        # Target of the composite FK from time_entries (timesheet_week_id, employee_id).
        UniqueConstraint("id", "employee_id", name="uq_timesheet_weeks_id_employee_id"),
        CheckConstraint("week_end_date = week_start_date + 6", name="week_is_seven_days"),
        Index("ix_timesheet_weeks_employee_id_week_start_date", "employee_id", "week_start_date"),
        Index("ix_timesheet_weeks_status_week_start_date", "status", "week_start_date"),
    )

    employee_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    week_start_date: Mapped[date] = mapped_column(Date, nullable=False)
    week_end_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[WeekStatus] = mapped_column(
        str_enum(WeekStatus, "status"), nullable=False, default=WeekStatus.DRAFT
    )
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT")
    )
    review_comment: Mapped[str | None] = mapped_column(Text)

    entries: Mapped[list[TimeEntry]] = relationship(back_populates="week")


class TimeEntry(IdMixin, TimestampMixin, Base):
    __tablename__ = "time_entries"
    __table_args__ = (
        ForeignKeyConstraint(
            ["timesheet_week_id", "employee_id"],
            ["timesheet_weeks.id", "timesheet_weeks.employee_id"],
            name="fk_time_entries_week_owner",
            ondelete="RESTRICT",
        ),
        # task_id is nullable: with MATCH SIMPLE this is only enforced when a task is chosen.
        ForeignKeyConstraint(
            ["project_id", "task_id"],
            ["project_tasks.project_id", "project_tasks.id"],
            name="fk_time_entries_task_in_project",
            ondelete="RESTRICT",
        ),
        CheckConstraint("hours > 0 AND hours <= 24", name="hours_range"),
        CheckConstraint(
            "char_length(trim(description)) > 0 AND char_length(description) <= 256",
            name="description_length",
        ),
        Index("ix_time_entries_timesheet_week_id_work_date", "timesheet_week_id", "work_date"),
        Index("ix_time_entries_employee_id_work_date", "employee_id", "work_date"),
    )

    timesheet_week_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    employee_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    work_date: Mapped[date] = mapped_column(Date, nullable=False)
    hours: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    earning_code_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("earning_codes.id", ondelete="RESTRICT"), nullable=False
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="RESTRICT"), nullable=False
    )
    task_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    description: Mapped[str] = mapped_column(String(256), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")

    week: Mapped[TimesheetWeek] = relationship(back_populates="entries")
    earning_code: Mapped[EarningCode] = relationship()
    project: Mapped[Project] = relationship()
    task: Mapped[ProjectTask | None] = relationship(
        primaryjoin="and_(TimeEntry.task_id == ProjectTask.id)",
        foreign_keys=[task_id],
    )


class ApprovalAction(enum.StrEnum):
    SUBMITTED = "SUBMITTED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    WITHDRAWN = "WITHDRAWN"


class ApprovalEvent(IdMixin, Base):
    """Append-only audit history of week lifecycle transitions."""

    __tablename__ = "approval_events"
    __table_args__ = (
        Index("ix_approval_events_timesheet_week_id_created_at", "timesheet_week_id", "created_at"),
    )

    timesheet_week_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("timesheet_weeks.id", ondelete="RESTRICT"), nullable=False
    )
    actor_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    action: Mapped[ApprovalAction] = mapped_column(
        str_enum(ApprovalAction, "action"), nullable=False
    )
    comment: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class EntryAction(enum.StrEnum):
    CREATED = "CREATED"
    UPDATED = "UPDATED"
    DELETED = "DELETED"


class TimeEntryEvent(IdMixin, Base):
    """Append-only audit of time-entry changes.

    ``time_entry_id`` is intentionally not a foreign key so history outlives deleted entries.
    ``details`` holds ids, dates and hours only; free-text descriptions are never copied here.
    """

    __tablename__ = "time_entry_events"
    __table_args__ = (
        Index(
            "ix_time_entry_events_timesheet_week_id_created_at", "timesheet_week_id", "created_at"
        ),
        Index("ix_time_entry_events_time_entry_id", "time_entry_id"),
    )

    timesheet_week_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("timesheet_weeks.id", ondelete="RESTRICT"), nullable=False
    )
    time_entry_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    actor_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    action: Mapped[EntryAction] = mapped_column(str_enum(EntryAction, "action"), nullable=False)
    details: Mapped[dict[str, object]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class OutboxStatus(enum.StrEnum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    SENT = "SENT"
    FAILED = "FAILED"


class NotificationOutbox(IdMixin, Base):
    __tablename__ = "notification_outbox"
    __table_args__ = (Index("ix_notification_outbox_status_created_at", "status", "created_at"),)

    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    aggregate_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    payload: Mapped[dict[str, object]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    status: Mapped[OutboxStatus] = mapped_column(
        str_enum(OutboxStatus, "status"), nullable=False, default=OutboxStatus.PENDING
    )
    attempt_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)


class IdempotencyKey(IdMixin, Base):
    """Remembers that a client-supplied key already produced an effect for an aggregate.

    A retry carrying the same key (same user, same scope) is answered with the current state instead
    of being treated as a conflicting duplicate.
    """

    __tablename__ = "idempotency_keys"
    __table_args__ = (
        UniqueConstraint("user_id", "scope", "key", name="uq_idempotency_keys_user_scope_key"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    scope: Mapped[str] = mapped_column(String(50), nullable=False)
    key: Mapped[str] = mapped_column(String(100), nullable=False)
    aggregate_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
