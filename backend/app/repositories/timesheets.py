from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models import EntryAction, TimeEntry, TimeEntryEvent, TimesheetWeek, WeekStatus


def get_week_with_entries(
    db: Session, employee_id: uuid.UUID, week_start_date: date
) -> TimesheetWeek | None:
    stmt = (
        select(TimesheetWeek)
        .where(
            TimesheetWeek.employee_id == employee_id,
            TimesheetWeek.week_start_date == week_start_date,
        )
        .options(
            selectinload(TimesheetWeek.entries).options(
                joinedload(TimeEntry.project),
                joinedload(TimeEntry.task),
                joinedload(TimeEntry.earning_code),
            )
        )
    )
    return db.scalar(stmt)


def get_or_create_week_for_update(
    db: Session, employee_id: uuid.UUID, start: date, end: date
) -> TimesheetWeek:
    """Idempotently create the week row, then lock it until the transaction ends.

    ``ON CONFLICT DO NOTHING`` makes concurrent first writes safe (exactly one row); the row lock
    serialises every writer of the same week, which is also what submission will rely on.
    """
    db.execute(
        pg_insert(TimesheetWeek)
        .values(
            employee_id=employee_id,
            week_start_date=start,
            week_end_date=end,
            status=WeekStatus.DRAFT,
        )
        .on_conflict_do_nothing(index_elements=["employee_id", "week_start_date"])
    )
    return db.execute(
        select(TimesheetWeek)
        .where(
            TimesheetWeek.employee_id == employee_id,
            TimesheetWeek.week_start_date == start,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one()


def lock_week(db: Session, week_id: uuid.UUID) -> TimesheetWeek | None:
    return db.execute(
        select(TimesheetWeek)
        .where(TimesheetWeek.id == week_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()


def get_owned_entry_week_id(
    db: Session, entry_id: uuid.UUID, employee_id: uuid.UUID
) -> uuid.UUID | None:
    return db.scalar(
        select(TimeEntry.timesheet_week_id).where(
            TimeEntry.id == entry_id, TimeEntry.employee_id == employee_id
        )
    )


def get_entry_with_refs(db: Session, entry_id: uuid.UUID) -> TimeEntry | None:
    return db.execute(
        select(TimeEntry)
        .where(TimeEntry.id == entry_id)
        .options(
            joinedload(TimeEntry.project),
            joinedload(TimeEntry.task),
            joinedload(TimeEntry.earning_code),
        )
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()


def add_entry_event(
    db: Session,
    *,
    week_id: uuid.UUID,
    entry_id: uuid.UUID,
    actor_id: uuid.UUID,
    action: EntryAction,
    details: dict[str, object],
) -> None:
    db.add(
        TimeEntryEvent(
            timesheet_week_id=week_id,
            time_entry_id=entry_id,
            actor_id=actor_id,
            action=action,
            details=details,
        )
    )
