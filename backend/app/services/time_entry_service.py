"""Create, update and delete a user's own time entries.

Every mutation: validates all fields (collecting every error), locks the parent week row,
requires the week to be editable, writes the change and an audit event in one transaction.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import (
    NotFoundError,
    StaleEntryError,
    ValidationFailedError,
    WeekNotEditableError,
)
from app.models import EntryAction, TimeEntry, TimesheetWeek, User
from app.repositories import reference as reference_repo
from app.repositories import timesheets as repo
from app.schemas.time_entry import TimeEntryCreate, TimeEntryUpdate
from app.services import entry_rules, summary, weeks


def _snapshot(entry: TimeEntry) -> dict[str, object]:
    """Audit-safe view of an entry: ids, date and hours only (never the description)."""
    return {
        "work_date": entry.work_date.isoformat(),
        "hours": str(entry.hours),
        "project_id": str(entry.project_id),
        "task_id": str(entry.task_id) if entry.task_id else None,
        "earning_code_id": str(entry.earning_code_id),
    }


def _require_editable(week: TimesheetWeek) -> None:
    if week.status not in summary.EDITABLE_STATUSES:
        raise WeekNotEditableError(
            f"This week is {week.status.value.lower()} and cannot be changed."
        )


def _check_references(
    db: Session,
    *,
    project_id: uuid.UUID,
    task_id: uuid.UUID | None,
    earning_code_id: uuid.UUID,
    existing: TimeEntry | None,
    task_rule_applies: bool,
    errors: dict[str, str],
) -> None:
    """Existence/consistency checks; unchanged references of an existing entry may be inactive."""
    project = reference_repo.get_project(db, project_id)
    if project is None:
        errors["project_id"] = "Select a valid project."
    elif not project.is_active and not (existing and existing.project_id == project_id):
        errors["project_id"] = "Select an active project."

    earning = reference_repo.get_earning_code(db, earning_code_id)
    if earning is None:
        errors["earning_code_id"] = "Select a valid earning code."
    elif not earning.is_active and not (existing and existing.earning_code_id == earning_code_id):
        errors["earning_code_id"] = "Select an active earning code."

    if project is None:
        return
    if task_id is not None:
        task = reference_repo.get_task(db, task_id)
        if task is None or task.project_id != project_id:
            errors["task_id"] = "Select a task that belongs to the chosen project."
        elif not task.is_active and not (existing and existing.task_id == task_id):
            errors["task_id"] = "Select an active task."
    elif task_rule_applies and reference_repo.project_has_active_tasks(db, project_id):
        errors["task_id"] = "Select a task for this project."


def _check_scalars(
    work_date: date,
    hours: Decimal,
    description: str,
    settings: Settings,
    errors: dict[str, str],
) -> None:
    for field, message in (
        ("work_date", entry_rules.check_work_date_supported(work_date)),
        ("hours", entry_rules.check_hours(hours, settings.max_hours_per_entry)),
        (
            "description",
            entry_rules.check_description(description, settings.description_max_length),
        ),
    ):
        if message:
            errors[field] = message


def create_entry(
    db: Session, user: User, payload: TimeEntryCreate, settings: Settings
) -> TimeEntry:
    errors: dict[str, str] = {}
    _check_scalars(payload.work_date, payload.hours, payload.description, settings, errors)
    _check_references(
        db,
        project_id=payload.project_id,
        task_id=payload.task_id,
        earning_code_id=payload.earning_code_id,
        existing=None,
        task_rule_applies=True,
        errors=errors,
    )
    if errors:
        raise ValidationFailedError(field_errors=errors)

    start = weeks.week_start_for(payload.work_date, settings.week_start_day)
    week = repo.get_or_create_week_for_update(db, user.id, start, weeks.week_end_for(start))
    _require_editable(week)

    entry = TimeEntry(
        timesheet_week_id=week.id,
        employee_id=user.id,
        work_date=payload.work_date,
        hours=payload.hours.quantize(entry_rules.TWO_PLACES),
        earning_code_id=payload.earning_code_id,
        project_id=payload.project_id,
        task_id=payload.task_id,
        description=payload.description.strip(),
    )
    db.add(entry)
    db.flush()
    repo.add_entry_event(
        db,
        week_id=week.id,
        entry_id=entry.id,
        actor_id=user.id,
        action=EntryAction.CREATED,
        details=_snapshot(entry),
    )
    db.commit()
    return _reload(db, entry.id)


def update_entry(
    db: Session, user: User, entry_id: uuid.UUID, payload: TimeEntryUpdate, settings: Settings
) -> TimeEntry:
    changes = payload.model_dump(exclude={"version"}, exclude_unset=True)
    if not changes:
        raise ValidationFailedError(
            field_errors={"request": "Provide at least one field to change."}
        )
    for field in ("work_date", "hours", "earning_code_id", "project_id", "description"):
        if field in changes and changes[field] is None:
            raise ValidationFailedError(field_errors={field: "This field cannot be null."})

    week = _lock_owned_entry_week(db, user, entry_id)
    entry = repo.get_entry_with_refs(db, entry_id)
    if entry is None:
        raise NotFoundError("Time entry not found.")
    _require_editable(week)
    if payload.version is not None and payload.version != entry.version:
        raise StaleEntryError()

    before = _snapshot(entry)
    new: dict[str, Any] = {
        "work_date": changes.get("work_date", entry.work_date),
        "hours": changes.get("hours", entry.hours),
        "earning_code_id": changes.get("earning_code_id", entry.earning_code_id),
        "project_id": changes.get("project_id", entry.project_id),
        "task_id": changes.get("task_id", entry.task_id),
        "description": changes.get("description", entry.description),
    }

    errors: dict[str, str] = {}
    _check_scalars(new["work_date"], new["hours"], new["description"], settings, errors)
    if "work_date" not in errors and not (
        week.week_start_date <= new["work_date"] <= week.week_end_date
    ):
        errors["work_date"] = (
            "Date must stay within the entry's week "
            f"({week.week_start_date.isoformat()} to {week.week_end_date.isoformat()}). "
            "Delete this entry and add a new one to record time in another week."
        )
    _check_references(
        db,
        project_id=new["project_id"],
        task_id=new["task_id"],
        earning_code_id=new["earning_code_id"],
        existing=entry,
        # The "task required" rule applies only when the project or task is really being changed,
        # so editing e.g. the hours of an older entry is never blocked by newer task data.
        task_rule_applies=(
            new["project_id"] != entry.project_id or new["task_id"] != entry.task_id
        ),
        errors=errors,
    )
    if errors:
        raise ValidationFailedError(field_errors=errors)

    description_changed = new["description"].strip() != entry.description
    entry.work_date = new["work_date"]
    entry.hours = new["hours"].quantize(entry_rules.TWO_PLACES)
    entry.earning_code_id = new["earning_code_id"]
    entry.project_id = new["project_id"]
    entry.task_id = new["task_id"]
    entry.description = new["description"].strip()
    after = _snapshot(entry)
    diff = {k: {"from": before[k], "to": after[k]} for k in before if before[k] != after[k]}
    if diff or description_changed:
        entry.version += 1
        repo.add_entry_event(
            db,
            week_id=week.id,
            entry_id=entry.id,
            actor_id=user.id,
            action=EntryAction.UPDATED,
            details={"changes": diff, "description_changed": description_changed},
        )
    db.commit()
    return _reload(db, entry.id)


def delete_entry(db: Session, user: User, entry_id: uuid.UUID) -> None:
    week = _lock_owned_entry_week(db, user, entry_id)
    entry = repo.get_entry_with_refs(db, entry_id)
    if entry is None:
        raise NotFoundError("Time entry not found.")
    _require_editable(week)
    repo.add_entry_event(
        db,
        week_id=week.id,
        entry_id=entry.id,
        actor_id=user.id,
        action=EntryAction.DELETED,
        details=_snapshot(entry),
    )
    db.delete(entry)
    db.commit()


def _lock_owned_entry_week(db: Session, user: User, entry_id: uuid.UUID) -> TimesheetWeek:
    """404 for unknown *and* foreign entries (no enumeration), then lock the parent week."""
    week_id = repo.get_owned_entry_week_id(db, entry_id, user.id)
    week = repo.lock_week(db, week_id) if week_id else None
    if week is None:
        raise NotFoundError("Time entry not found.")
    return week


def _reload(db: Session, entry_id: uuid.UUID) -> TimeEntry:
    entry = repo.get_entry_with_refs(db, entry_id)
    if entry is None:  # cannot happen: written in this transaction
        raise NotFoundError("Time entry not found.")
    return entry
