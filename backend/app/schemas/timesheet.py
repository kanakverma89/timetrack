from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models import Classification, WeekStatus


class ProjectRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    code: str
    name: str


class TaskRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    code: str
    name: str


class EarningCodeRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    code: str
    name: str
    classification: Classification


class TimeEntryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    work_date: date
    hours: Decimal
    description: str
    version: int
    project: ProjectRef
    task: TaskRef | None
    earning_code: EarningCodeRef


class WeekSummaryRead(BaseModel):
    total_hours: Decimal
    capped_hours: Decimal
    non_capped_hours: Decimal
    entry_count: int
    draft_count: int


class DailyTotalRead(BaseModel):
    date: date
    hours: Decimal


class TimesheetWeekRead(BaseModel):
    id: uuid.UUID | None
    week_start_date: date
    week_end_date: date
    status: WeekStatus
    submitted_at: datetime | None
    reviewed_at: datetime | None
    review_comment: str | None
    reviewed_by_name: str | None = None
    is_editable: bool
    summary: WeekSummaryRead
    daily_totals: list[DailyTotalRead]
    entries: list[TimeEntryRead]


class TimeEntryBatchRead(BaseModel):
    entries: list[TimeEntryRead]
    summary: WeekSummaryRead
    daily_totals: list[DailyTotalRead]


class SubmitRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    comment: str | None = Field(default=None, max_length=500)
