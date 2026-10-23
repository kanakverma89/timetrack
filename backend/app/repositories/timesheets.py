from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models import TimeEntry, TimesheetWeek


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
