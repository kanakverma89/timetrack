"""Weekly submission: DRAFT/REJECTED -> SUBMITTED (spec §3.8, §8.6).

One transaction does everything: it locks the week row, checks the lifecycle state, re-validates the
stored entries and the configured weekly policy, flips the status, appends the audit event, enqueues
the manager notification and records the idempotency key. Nothing is visible unless all of it
commits. The row lock serialises concurrent submits, so a week can be submitted only once.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import (
    BusinessRuleError,
    InvalidTransitionError,
    ValidationFailedError,
)
from app.models import ApprovalAction, User, WeekStatus
from app.repositories import timesheets as repo
from app.schemas.timesheet import TimesheetWeekRead
from app.services import notifications, submission_rules, summary, timesheet_service, weeks
from app.services.policy import effective_policy

SCOPE = "week_submit"
EVENT_TYPE = "TIMESHEET_SUBMITTED"


@dataclass(frozen=True)
class SubmissionResult:
    week: TimesheetWeekRead
    #: True when this call performed the transition (False for an idempotent replay).
    transitioned: bool


def submit_week(
    db: Session,
    user: User,
    any_date: date,
    *,
    comment: str | None,
    idempotency_key: str | None,
    settings: Settings,
) -> SubmissionResult:
    if not weeks.is_supported_date(any_date):
        raise ValidationFailedError(
            field_errors={
                "week_start_date": f"Date must be between {weeks.MIN_YEAR} and {weeks.MAX_YEAR}."
            }
        )
    start = weeks.week_start_for(any_date, settings.week_start_day)
    comment = comment.strip() if comment and comment.strip() else None

    week = repo.lock_week_by_start(db, user.id, start)

    # A retry that carries a key we have already honoured is answered with the current state.
    if idempotency_key is not None:
        known = repo.get_idempotency_key(db, user.id, SCOPE, idempotency_key)
        if known is not None:
            if week is None or known.aggregate_id != week.id:
                raise ValidationFailedError(
                    field_errors={
                        "Idempotency-Key": "This key was already used for a different week."
                    }
                )
            db.rollback()  # release the row lock; nothing to change
            return SubmissionResult(
                timesheet_service.get_week_view(db, user, start, settings), transitioned=False
            )

    if week is None:
        raise BusinessRuleError(
            "The week cannot be submitted yet.",
            field_errors={"entries": "Add at least one time entry before submitting."},
        )
    if week.status not in summary.EDITABLE_STATUSES:
        raise InvalidTransitionError(
            f"This week is {week.status.value.lower()} and cannot be submitted."
        )

    entries = repo.list_week_entries(db, week.id)
    if not entries:
        raise BusinessRuleError(
            "The week cannot be submitted yet.",
            field_errors={"entries": "Add at least one time entry before submitting."},
        )

    policy = effective_policy(db, settings)
    views = [
        submission_rules.EntryView(str(e.id), e.work_date, e.hours, e.description) for e in entries
    ]
    errors = submission_rules.check_entries(
        views,
        week_start=week.week_start_date,
        week_end=week.week_end_date,
        max_hours_per_entry=policy.max_hours_per_entry,
        description_max=policy.description_max_length,
    )
    errors.update(
        submission_rules.check_policy(
            views,
            max_hours_per_day=policy.max_hours_per_day,
            max_hours_per_week=policy.max_hours_per_week,
        )
    )
    if errors:
        raise BusinessRuleError("The week cannot be submitted yet.", field_errors=errors)

    resubmission = week.status is WeekStatus.REJECTED
    total = sum((e.hours for e in entries), Decimal("0.00"))
    week.status = WeekStatus.SUBMITTED
    week.submitted_at = datetime.now(UTC)
    # The previous decision is history (approval_events); the live row reflects this submission.
    week.reviewed_at = None
    week.reviewed_by = None
    week.review_comment = None
    repo.add_approval_event(
        db,
        week_id=week.id,
        actor_id=user.id,
        action=ApprovalAction.SUBMITTED,
        comment=comment,
    )
    notifications.enqueue(
        db,
        event_type=EVENT_TYPE,
        aggregate_id=week.id,
        payload={
            "week_id": str(week.id),
            "employee_id": str(user.id),
            "manager_id": str(user.manager_id) if user.manager_id else None,
            "week_start_date": week.week_start_date.isoformat(),
            "entry_count": len(entries),
            "total_hours": str(total.quantize(Decimal("0.01"))),
            "resubmission": resubmission,
        },
    )
    if idempotency_key is not None:
        repo.remember_idempotency_key(
            db, user_id=user.id, scope=SCOPE, key=idempotency_key, aggregate_id=week.id
        )
    db.commit()
    return SubmissionResult(
        timesheet_service.get_week_view(db, user, start, settings), transitioned=True
    )
