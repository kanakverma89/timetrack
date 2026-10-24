from __future__ import annotations

import enum
from datetime import date
from decimal import Decimal

from pydantic import BaseModel

from app.models import WeekStatus
from app.schemas.admin import Page


class GroupBy(enum.StrEnum):
    EMPLOYEE = "employee"
    PROJECT = "project"
    EARNING_CODE = "earning_code"
    WEEK = "week"


class ReportRow(BaseModel):
    key: str
    label: str
    detail: str | None
    total_hours: Decimal
    capped_hours: Decimal
    non_capped_hours: Decimal
    entry_count: int
    employee_count: int


class ReportTotals(BaseModel):
    total_hours: Decimal
    capped_hours: Decimal
    non_capped_hours: Decimal
    entry_count: int
    employee_count: int


class HoursReport(Page):
    group_by: GroupBy
    date_from: date
    date_to: date
    statuses: list[WeekStatus]
    items: list[ReportRow]
    totals: ReportTotals
