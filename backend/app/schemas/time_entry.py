from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class TimeEntryCreate(BaseModel):
    """Client input. The employee is always the authenticated user, never a payload field."""

    model_config = ConfigDict(extra="forbid")

    work_date: date
    hours: Decimal
    earning_code_id: uuid.UUID
    project_id: uuid.UUID
    task_id: uuid.UUID | None = None
    description: str


class TimeEntryUpdate(BaseModel):
    """Partial update. ``task_id: null`` explicitly clears the task; omitting it keeps it."""

    model_config = ConfigDict(extra="forbid")

    work_date: date | None = None
    hours: Decimal | None = None
    earning_code_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None
    task_id: uuid.UUID | None = None
    description: str | None = None
    version: int | None = None
