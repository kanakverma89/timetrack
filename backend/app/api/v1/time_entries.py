from __future__ import annotations

import uuid

from fastapi import APIRouter, Response

from app.schemas.time_entry import TimeEntryBatchCreate, TimeEntryCreate, TimeEntryUpdate
from app.schemas.timesheet import TimeEntryBatchRead, TimeEntryRead
from app.security.dependencies import CurrentUser, DbDep, SettingsDep
from app.services import time_entry_service

router = APIRouter(prefix="/time-entries", tags=["time-entries"])


@router.post("", status_code=201, response_model=TimeEntryRead)
def create_time_entry(
    body: TimeEntryCreate, user: CurrentUser, db: DbDep, settings: SettingsDep
) -> TimeEntryRead:
    entry = time_entry_service.create_entry(db, user, body, settings)
    return TimeEntryRead.model_validate(entry)


@router.post("/batch", status_code=201, response_model=TimeEntryBatchRead)
def create_time_entries_batch(
    body: TimeEntryBatchCreate, user: CurrentUser, db: DbDep, settings: SettingsDep
) -> TimeEntryBatchRead:
    entries, week = time_entry_service.create_entries_batch(db, user, body, settings)
    return TimeEntryBatchRead(
        entries=[TimeEntryRead.model_validate(e) for e in entries],
        summary=week.summary,
        daily_totals=week.daily_totals,
    )


@router.patch("/{entry_id}", response_model=TimeEntryRead)
def update_time_entry(
    entry_id: uuid.UUID,
    body: TimeEntryUpdate,
    user: CurrentUser,
    db: DbDep,
    settings: SettingsDep,
) -> TimeEntryRead:
    entry = time_entry_service.update_entry(db, user, entry_id, body, settings)
    return TimeEntryRead.model_validate(entry)


@router.delete("/{entry_id}", status_code=204)
def delete_time_entry(entry_id: uuid.UUID, user: CurrentUser, db: DbDep) -> Response:
    time_entry_service.delete_entry(db, user, entry_id)
    return Response(status_code=204)
