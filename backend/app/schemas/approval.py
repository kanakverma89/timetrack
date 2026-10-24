from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models import ApprovalAction, WeekStatus
from app.schemas.timesheet import TimesheetWeekRead


class PersonRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    display_name: str
    email: str


class ApprovalListItem(BaseModel):
    week_id: uuid.UUID
    employee: PersonRef
    week_start_date: date
    week_end_date: date
    status: WeekStatus
    submitted_at: datetime | None
    reviewed_at: datetime | None
    reviewer_name: str | None
    total_hours: Decimal
    entry_count: int


class ApprovalList(BaseModel):
    items: list[ApprovalListItem]
    page: int
    page_size: int
    total: int


class HistoryItem(BaseModel):
    action: ApprovalAction
    actor: PersonRef
    comment: str | None
    created_at: datetime


class ApprovalDetail(BaseModel):
    employee: PersonRef
    week: TimesheetWeekRead
    history: list[HistoryItem]


class ApproveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    comment: str | None = Field(default=None, max_length=500)


class RejectRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Length is checked in the service (after trimming) with a friendly message.
    comment: str = Field(max_length=1000)
