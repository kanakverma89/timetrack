from __future__ import annotations

import re
from datetime import date
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Header, Request

from app.core.errors import ValidationFailedError
from app.schemas.timesheet import SubmitRequest, TimesheetWeekRead
from app.security.dependencies import CurrentUser, DbDep, SettingsDep
from app.services import notifications, submission_service, timesheet_service

router = APIRouter(prefix="/timesheets", tags=["timesheets"])

_KEY_PATTERN = re.compile(r"[A-Za-z0-9_-]{8,100}")


@router.get("/weeks/{week_start_date}", response_model=TimesheetWeekRead)
def get_week(
    week_start_date: date, user: CurrentUser, db: DbDep, settings: SettingsDep
) -> TimesheetWeekRead:
    """The authenticated employee's week containing the given date (normalised to week start)."""
    return timesheet_service.get_week_view(db, user, week_start_date, settings)


@router.post("/weeks/{week_start_date}/submit", response_model=TimesheetWeekRead)
def submit_week(
    week_start_date: date,
    request: Request,
    background: BackgroundTasks,
    user: CurrentUser,
    db: DbDep,
    settings: SettingsDep,
    body: SubmitRequest | None = None,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> TimesheetWeekRead:
    """Submit the caller's week for approval. Safe to retry with the same ``Idempotency-Key``."""
    if idempotency_key is not None and not _KEY_PATTERN.fullmatch(idempotency_key):
        raise ValidationFailedError(
            field_errors={"Idempotency-Key": "Use 8-100 letters, digits, hyphens or underscores."}
        )
    result = submission_service.submit_week(
        db,
        user,
        week_start_date,
        comment=body.comment if body else None,
        idempotency_key=idempotency_key,
        settings=settings,
    )
    if result.transitioned:
        # Delivery happens after the response is sent and can never fail the request.
        background.add_task(
            notifications.process_pending,
            request.app.state.session_factory,
            request.app.state.notification_port,
            max_attempts=settings.notification_max_attempts,
        )
    return result.week


@router.post("/weeks/{week_start_date}/withdraw", response_model=TimesheetWeekRead)
def withdraw_week(
    week_start_date: date,
    request: Request,
    background: BackgroundTasks,
    user: CurrentUser,
    db: DbDep,
    settings: SettingsDep,
) -> TimesheetWeekRead:
    """Take back the caller's submitted week while it is still waiting for review (-> DRAFT)."""
    result = submission_service.withdraw_week(db, user, week_start_date, settings=settings)
    background.add_task(
        notifications.process_pending,
        request.app.state.session_factory,
        request.app.state.notification_port,
        max_attempts=settings.notification_max_attempts,
    )
    return result.week
