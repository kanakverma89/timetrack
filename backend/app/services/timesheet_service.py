from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import ValidationFailedError
from app.models import TimeEntry, TimesheetWeek, User, WeekStatus
from app.repositories import timesheets as timesheet_repo
from app.schemas.timesheet import (
    DailyTotalRead,
    TimeEntryRead,
    TimesheetWeekRead,
    WeekSummaryRead,
)
from app.services import summary, weeks


def _facts(week: TimesheetWeek) -> list[summary.EntryFacts]:
    return [
        summary.EntryFacts(e.work_date, e.hours, e.earning_code.classification)
        for e in week.entries
    ]


def get_week_view(
    db: Session, employee: User, any_date: date, settings: Settings
) -> TimesheetWeekRead:
    """Read-only view of the employee's week containing ``any_date`` (no rows are created).

    Totals are always recomputed from persisted entries; nothing client-supplied is trusted.
    """
    if not weeks.is_supported_date(any_date):
        raise ValidationFailedError(
            field_errors={
                "week_start_date": f"Date must be between {weeks.MIN_YEAR} and {weeks.MAX_YEAR}."
            }
        )
    start = weeks.week_start_for(any_date, settings.week_start_day)
    end = weeks.week_end_for(start)
    week = timesheet_repo.get_week_with_entries(db, employee.id, start)

    if week is None:
        status = WeekStatus.DRAFT
        entries_sorted: list[TimeEntry] = []
        facts: list[summary.EntryFacts] = []
    else:
        status = week.status
        entries_sorted = sorted(week.entries, key=lambda e: (e.work_date, e.created_at, e.id))
        facts = _facts(week)

    totals = summary.daily_totals(facts, weeks.week_dates(start))
    s = summary.summarize(facts, status)
    return TimesheetWeekRead(
        id=week.id if week else None,
        week_start_date=start,
        week_end_date=end,
        status=status,
        submitted_at=week.submitted_at if week else None,
        reviewed_at=week.reviewed_at if week else None,
        review_comment=week.review_comment if week else None,
        is_editable=status in summary.EDITABLE_STATUSES,
        summary=WeekSummaryRead(
            total_hours=s.total_hours,
            capped_hours=s.capped_hours,
            non_capped_hours=s.non_capped_hours,
            entry_count=s.entry_count,
            draft_count=s.draft_count,
        ),
        daily_totals=[DailyTotalRead(date=d, hours=h) for d, h in totals],
        entries=[TimeEntryRead.model_validate(e) for e in entries_sorted],
    )
