from __future__ import annotations

from datetime import date

from fastapi import APIRouter

from app.schemas.timesheet import TimesheetWeekRead
from app.security.dependencies import CurrentUser, DbDep, SettingsDep
from app.services import timesheet_service

router = APIRouter(prefix="/timesheets", tags=["timesheets"])


@router.get("/weeks/{week_start_date}", response_model=TimesheetWeekRead)
def get_week(
    week_start_date: date, user: CurrentUser, db: DbDep, settings: SettingsDep
) -> TimesheetWeekRead:
    """The authenticated employee's week containing the given date (normalised to week start)."""
    return timesheet_service.get_week_view(db, user, week_start_date, settings)
