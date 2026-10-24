from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import ColumnElement, func, select
from sqlalchemy.orm import Session, aliased

from app.models import ApprovalEvent, Role, TimeEntry, TimesheetWeek, User, WeekStatus

# Weeks a manager may ever see. Drafts are the employee's private work in progress.
VISIBLE_STATUSES = (WeekStatus.SUBMITTED, WeekStatus.APPROVED, WeekStatus.REJECTED)


@dataclass(frozen=True)
class ApprovalRow:
    week: TimesheetWeek
    employee: User
    reviewer_name: str | None
    total_hours: Decimal
    entry_count: int


def _scope(actor: User, employee: type[User]) -> list[ColumnElement[bool]]:
    """SQL form of ``review_policy.in_review_scope`` (kept equal by a parity test)."""
    conditions: list[ColumnElement[bool]] = [employee.id != actor.id]
    if actor.role is not Role.ADMIN:
        conditions.append(employee.manager_id == actor.id)
    return conditions


def list_for_review(
    db: Session,
    actor: User,
    *,
    status: WeekStatus,
    week_start: date | None,
    page: int,
    page_size: int,
) -> tuple[list[ApprovalRow], int]:
    employee = aliased(User)
    reviewer = aliased(User)
    totals = (
        select(
            TimeEntry.timesheet_week_id.label("week_id"),
            func.coalesce(func.sum(TimeEntry.hours), 0).label("total"),
            func.count().label("n"),
        )
        .group_by(TimeEntry.timesheet_week_id)
        .subquery()
    )
    conditions: list[ColumnElement[bool]] = [
        TimesheetWeek.status == status,
        *_scope(actor, employee),
    ]
    if week_start is not None:
        conditions.append(TimesheetWeek.week_start_date == week_start)

    total = db.scalar(
        select(func.count())
        .select_from(TimesheetWeek)
        .join(employee, employee.id == TimesheetWeek.employee_id)
        .where(*conditions)
    )
    rows = db.execute(
        select(
            TimesheetWeek,
            employee,
            reviewer.display_name,
            func.coalesce(totals.c.total, 0),
            func.coalesce(totals.c.n, 0),
        )
        .join(employee, employee.id == TimesheetWeek.employee_id)
        .outerjoin(reviewer, reviewer.id == TimesheetWeek.reviewed_by)
        .outerjoin(totals, totals.c.week_id == TimesheetWeek.id)
        .where(*conditions)
        # Oldest submission first (they have waited longest); id keeps paging stable.
        .order_by(TimesheetWeek.submitted_at.asc().nulls_last(), TimesheetWeek.id)
        .limit(page_size)
        .offset((page - 1) * page_size)
    ).all()
    items = [
        ApprovalRow(w, e, name, Decimal(t).quantize(Decimal("0.01")), int(n))
        for w, e, name, t, n in rows
    ]
    return items, int(total or 0)


def history(db: Session, week_id: uuid.UUID) -> list[tuple[ApprovalEvent, User]]:
    rows = db.execute(
        select(ApprovalEvent, User)
        .join(User, User.id == ApprovalEvent.actor_id)
        .where(ApprovalEvent.timesheet_week_id == week_id)
        .order_by(ApprovalEvent.created_at, ApprovalEvent.id)
    ).all()
    return [(event, actor) for event, actor in rows]
