from __future__ import annotations

import re
import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Header, Query, Request

from app.core.errors import ValidationFailedError
from app.models import ApprovalAction, Role, WeekStatus
from app.schemas.approval import ApprovalDetail, ApprovalList, ApproveRequest, RejectRequest
from app.security.dependencies import CurrentUser, DbDep, SettingsDep, require_roles
from app.services import approval_service, notifications

# Deny by default: only managers and administrators reach any of these routes; the service then
# narrows that to the employees each of them is actually allowed to review.
router = APIRouter(
    prefix="/approvals",
    tags=["approvals"],
    dependencies=[Depends(require_roles(Role.MANAGER, Role.ADMIN))],
)

_KEY_PATTERN = re.compile(r"[A-Za-z0-9_-]{8,100}")
IdempotencyKeyHeader = Annotated[str | None, Header(alias="Idempotency-Key")]


def _checked_key(key: str | None) -> str | None:
    if key is not None and not _KEY_PATTERN.fullmatch(key):
        raise ValidationFailedError(
            field_errors={"Idempotency-Key": "Use 8-100 letters, digits, hyphens or underscores."}
        )
    return key


@router.get("", response_model=ApprovalList)
def list_approvals(
    user: CurrentUser,
    db: DbDep,
    settings: SettingsDep,
    status: WeekStatus = WeekStatus.SUBMITTED,
    week_start_date: date | None = None,
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> ApprovalList:
    return approval_service.list_submissions(
        db,
        user,
        status=status,
        week_start=week_start_date,
        page=page,
        page_size=page_size,
        settings=settings,
    )


@router.get("/{week_id}", response_model=ApprovalDetail)
def get_approval(
    week_id: uuid.UUID, user: CurrentUser, db: DbDep, settings: SettingsDep
) -> ApprovalDetail:
    return approval_service.get_detail(db, user, week_id, settings)


def _decide(
    action: ApprovalAction,
    week_id: uuid.UUID,
    comment: str | None,
    key: str | None,
    request: Request,
    background: BackgroundTasks,
    user: CurrentUser,
    db: DbDep,
    settings: SettingsDep,
) -> ApprovalDetail:
    result = approval_service.decide(
        db,
        user,
        week_id,
        action,
        comment=comment,
        idempotency_key=_checked_key(key),
        settings=settings,
    )
    if result.transitioned:
        background.add_task(
            notifications.process_pending,
            request.app.state.session_factory,
            request.app.state.notification_port,
            max_attempts=settings.notification_max_attempts,
        )
    return result.detail


@router.post("/{week_id}/approve", response_model=ApprovalDetail)
def approve(
    week_id: uuid.UUID,
    request: Request,
    background: BackgroundTasks,
    user: CurrentUser,
    db: DbDep,
    settings: SettingsDep,
    body: ApproveRequest | None = None,
    idempotency_key: IdempotencyKeyHeader = None,
) -> ApprovalDetail:
    return _decide(
        ApprovalAction.APPROVED,
        week_id,
        body.comment if body else None,
        idempotency_key,
        request,
        background,
        user,
        db,
        settings,
    )


@router.post("/{week_id}/reject", response_model=ApprovalDetail)
def reject(
    week_id: uuid.UUID,
    body: RejectRequest,
    request: Request,
    background: BackgroundTasks,
    user: CurrentUser,
    db: DbDep,
    settings: SettingsDep,
    idempotency_key: IdempotencyKeyHeader = None,
) -> ApprovalDetail:
    return _decide(
        ApprovalAction.REJECTED,
        week_id,
        body.comment,
        idempotency_key,
        request,
        background,
        user,
        db,
        settings,
    )
