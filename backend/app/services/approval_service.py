"""Manager review of submitted weeks: list, detail, approve, reject (spec §8.7, §9 rules 2, 12, 17).

A decision is one transaction under the week's row lock: it re-checks that the actor may review
this employee, that the week is still SUBMITTED, then writes the new status, the reviewer, the
append-only approval event, an employee notification (ids only, never the reason text) and the
idempotency key. A week can therefore be decided exactly once per submission, even if two
managers (or one impatient manager) act at the same moment.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import (
    ForbiddenError,
    InvalidTransitionError,
    NotFoundError,
    ValidationFailedError,
)
from app.models import ApprovalAction, TimesheetWeek, User, WeekStatus
from app.repositories import approvals as repo
from app.repositories import timesheets as timesheet_repo
from app.schemas.approval import (
    ApprovalDetail,
    ApprovalList,
    ApprovalListItem,
    HistoryItem,
    PersonRef,
)
from app.services import notifications, review_policy, timesheet_service, weeks

SCOPE = "week_decision"
MIN_REASON_LENGTH = 5
APPROVED_EVENT = "TIMESHEET_APPROVED"
REJECTED_EVENT = "TIMESHEET_REJECTED"


@dataclass(frozen=True)
class DecisionResult:
    detail: ApprovalDetail
    #: True when this call made the decision (False for an idempotent replay).
    transitioned: bool


def list_submissions(
    db: Session,
    actor: User,
    *,
    status: WeekStatus,
    week_start: date | None,
    page: int,
    page_size: int,
    settings: Settings,
) -> ApprovalList:
    if status is WeekStatus.DRAFT:
        raise ValidationFailedError(
            field_errors={"status": "Draft weeks are private to the employee."}
        )
    start = None
    if week_start is not None:
        if not weeks.is_supported_date(week_start):
            raise ValidationFailedError(
                field_errors={
                    "week_start_date": (
                        f"Date must be between {weeks.MIN_YEAR} and {weeks.MAX_YEAR}."
                    )
                }
            )
        start = weeks.week_start_for(week_start, settings.week_start_day)
    rows, total = repo.list_for_review(
        db, actor, status=status, week_start=start, page=page, page_size=page_size
    )
    return ApprovalList(
        items=[
            ApprovalListItem(
                week_id=r.week.id,
                employee=PersonRef.model_validate(r.employee),
                week_start_date=r.week.week_start_date,
                week_end_date=r.week.week_end_date,
                status=r.week.status,
                submitted_at=r.week.submitted_at,
                reviewed_at=r.week.reviewed_at,
                reviewer_name=r.reviewer_name,
                total_hours=r.total_hours,
                entry_count=r.entry_count,
            )
            for r in rows
        ],
        page=page,
        page_size=page_size,
        total=total,
    )


def _authorized_week(
    db: Session, actor: User, week_id: uuid.UUID, *, lock: bool
) -> tuple[TimesheetWeek, User]:
    """The week and its employee, or an error that reveals nothing the actor may not know.

    * own week              -> 403 (they know it exists; they just may not decide on it)
    * unknown / out of scope / draft -> 404 (indistinguishable, so ids cannot be probed)
    """
    week = timesheet_repo.lock_week(db, week_id) if lock else db.get(TimesheetWeek, week_id)
    if week is None:
        raise NotFoundError("Timesheet not found.")
    if review_policy.is_own_week(actor_id=actor.id, employee_id=week.employee_id):
        raise ForbiddenError("You cannot review your own timesheet.")
    employee = db.get(User, week.employee_id)
    if (
        employee is None
        or week.status is WeekStatus.DRAFT
        or not review_policy.in_review_scope(
            actor_id=actor.id,
            actor_role=actor.role,
            employee_id=employee.id,
            employee_manager_id=employee.manager_id,
        )
    ):
        raise NotFoundError("Timesheet not found.")
    return week, employee


def _detail(db: Session, week: TimesheetWeek, employee: User, settings: Settings) -> ApprovalDetail:
    view = timesheet_service.get_week_view(db, employee, week.week_start_date, settings)
    return ApprovalDetail(
        employee=PersonRef.model_validate(employee),
        week=view,
        history=[
            HistoryItem(
                action=event.action,
                actor=PersonRef.model_validate(actor),
                comment=event.comment,
                created_at=event.created_at,
            )
            for event, actor in repo.history(db, week.id)
        ],
    )


def get_detail(db: Session, actor: User, week_id: uuid.UUID, settings: Settings) -> ApprovalDetail:
    week, employee = _authorized_week(db, actor, week_id, lock=False)
    return _detail(db, week, employee, settings)


def decide(
    db: Session,
    actor: User,
    week_id: uuid.UUID,
    action: ApprovalAction,
    *,
    comment: str | None,
    idempotency_key: str | None,
    settings: Settings,
) -> DecisionResult:
    if action not in (ApprovalAction.APPROVED, ApprovalAction.REJECTED):
        raise ValueError(f"Not a review decision: {action}")
    comment = comment.strip() if comment and comment.strip() else None

    week, employee = _authorized_week(db, actor, week_id, lock=True)

    # A retry carrying a key we already honoured is answered with the current state.
    if idempotency_key is not None:
        known = timesheet_repo.get_idempotency_key(db, actor.id, SCOPE, idempotency_key)
        if known is not None:
            if known.aggregate_id != week.id:
                raise ValidationFailedError(
                    field_errors={
                        "Idempotency-Key": "This key was already used for a different timesheet."
                    }
                )
            db.rollback()  # release the row lock; nothing to change
            return DecisionResult(get_detail(db, actor, week_id, settings), transitioned=False)

    if week.status is not WeekStatus.SUBMITTED:
        raise InvalidTransitionError(
            f"This week is {week.status.value.lower()}; only a submitted week can be "
            f"{'approved' if action is ApprovalAction.APPROVED else 'rejected'}."
        )
    if action is ApprovalAction.REJECTED and (comment is None or len(comment) < MIN_REASON_LENGTH):
        raise ValidationFailedError(
            field_errors={
                "comment": (
                    f"Explain why the week is rejected (at least {MIN_REASON_LENGTH} characters)."
                )
            }
        )

    approved = action is ApprovalAction.APPROVED
    week.status = WeekStatus.APPROVED if approved else WeekStatus.REJECTED
    week.reviewed_at = datetime.now(UTC)
    week.reviewed_by = actor.id
    week.review_comment = comment
    timesheet_repo.add_approval_event(
        db, week_id=week.id, actor_id=actor.id, action=action, comment=comment
    )
    notifications.enqueue(
        db,
        event_type=APPROVED_EVENT if approved else REJECTED_EVENT,
        aggregate_id=week.id,
        # Ids and the decision only: the reason is free text and stays in the app.
        payload={
            "week_id": str(week.id),
            "employee_id": str(employee.id),
            "reviewer_id": str(actor.id),
            "week_start_date": week.week_start_date.isoformat(),
            "decision": week.status.value,
        },
    )
    if idempotency_key is not None:
        timesheet_repo.remember_idempotency_key(
            db, user_id=actor.id, scope=SCOPE, key=idempotency_key, aggregate_id=week.id
        )
    db.commit()
    return DecisionResult(get_detail(db, actor, week_id, settings), transitioned=True)
