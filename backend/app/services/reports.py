"""Hours reporting for managers and administrators (spec Phase 7: reporting and pagination).

Scope is the *review* scope (``review_policy``): a manager reports on their assigned employees, an
administrator on everyone, and nobody on their own hours here. Only entries inside weeks that are
in one of the requested statuses count (default: approved), so a report never includes drafts.
"""

from __future__ import annotations

import csv
import io
import uuid
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import ColumnElement, Select, case, func, select
from sqlalchemy.orm import Session, aliased

from app.core.errors import ValidationFailedError
from app.models import (
    Classification,
    EarningCode,
    Project,
    Role,
    TimeEntry,
    TimesheetWeek,
    User,
    WeekStatus,
)
from app.schemas.report import GroupBy, HoursReport, ReportRow, ReportTotals

MAX_RANGE_DAYS = 366
MAX_EXPORT_ROWS = 100_000
ALLOWED_STATUSES = (WeekStatus.SUBMITTED, WeekStatus.APPROVED, WeekStatus.REJECTED)
_ZERO = Decimal("0.00")
_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def validate(start: date, end: date, statuses: list[WeekStatus]) -> list[WeekStatus]:
    errors: dict[str, str] = {}
    if end < start:
        errors["date_to"] = "The end date cannot be before the start date."
    elif (end - start).days > MAX_RANGE_DAYS:
        errors["date_to"] = f"The range cannot be longer than {MAX_RANGE_DAYS} days."
    unique = list(dict.fromkeys(statuses))
    if not unique or any(s not in ALLOWED_STATUSES for s in unique):
        errors["status"] = "Choose from submitted, approved or rejected (drafts are private)."
    if errors:
        raise ValidationFailedError(field_errors=errors)
    return unique


def _conditions(
    actor: User,
    employee: type[User],
    *,
    start: date,
    end: date,
    statuses: list[WeekStatus],
    employee_id: uuid.UUID | None,
    project_id: uuid.UUID | None,
) -> list[ColumnElement[bool]]:
    conditions: list[ColumnElement[bool]] = [
        TimeEntry.work_date.between(start, end),
        TimesheetWeek.status.in_(statuses),
        employee.id != actor.id,
    ]
    if actor.role is not Role.ADMIN:
        conditions.append(employee.manager_id == actor.id)
    if employee_id is not None:
        conditions.append(employee.id == employee_id)
    if project_id is not None:
        conditions.append(TimeEntry.project_id == project_id)
    return conditions


def _aggregates() -> list[ColumnElement[Any]]:
    capped = case((EarningCode.classification == Classification.CAPPED, TimeEntry.hours), else_=0)
    non_capped = case(
        (EarningCode.classification == Classification.NON_CAPPED, TimeEntry.hours), else_=0
    )
    return [
        func.coalesce(func.sum(TimeEntry.hours), 0),
        func.coalesce(func.sum(capped), 0),
        func.coalesce(func.sum(non_capped), 0),
        func.count(TimeEntry.id),
        func.count(func.distinct(TimeEntry.employee_id)),
    ]


def _n(value: object) -> int:
    return int(str(value))


def _money(value: object) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"))


def _base(employee: type[User]) -> Select[Any]:
    return (
        select(TimeEntry.id)  # replaced by the caller's column list
        .join(TimesheetWeek, TimesheetWeek.id == TimeEntry.timesheet_week_id)
        .join(employee, employee.id == TimeEntry.employee_id)
        .join(EarningCode, EarningCode.id == TimeEntry.earning_code_id)
        .join(Project, Project.id == TimeEntry.project_id)
    )


def _group_columns(group_by: GroupBy, employee: type[User]) -> tuple[Any, Any, Any]:
    """(key, label, detail) expressions for the chosen grouping."""
    if group_by is GroupBy.EMPLOYEE:
        return employee.id, employee.display_name, employee.email
    if group_by is GroupBy.PROJECT:
        return Project.id, Project.code, Project.name
    if group_by is GroupBy.EARNING_CODE:
        return EarningCode.id, EarningCode.code, EarningCode.name
    return (
        TimesheetWeek.week_start_date,
        func.to_char(TimesheetWeek.week_start_date, "YYYY-MM-DD"),
        None,
    )


def run_report(
    db: Session,
    actor: User,
    *,
    start: date,
    end: date,
    group_by: GroupBy,
    statuses: list[WeekStatus],
    employee_id: uuid.UUID | None,
    project_id: uuid.UUID | None,
    page: int,
    page_size: int,
) -> HoursReport:
    statuses = validate(start, end, statuses)
    employee = aliased(User)
    where = _conditions(
        actor,
        employee,
        start=start,
        end=end,
        statuses=statuses,
        employee_id=employee_id,
        project_id=project_id,
    )
    key, label, detail = _group_columns(group_by, employee)
    group_cols = [key, label] + ([detail] if detail is not None else [])

    grouped = (
        _base(employee)
        .with_only_columns(*group_cols, *_aggregates())
        .where(*where)
        .group_by(*group_cols)
    )
    total_groups = db.scalar(select(func.count()).select_from(grouped.subquery())) or 0
    rows = db.execute(
        grouped.order_by(label, key).limit(page_size).offset((page - 1) * page_size)
    ).all()

    totals = db.execute(_base(employee).with_only_columns(*_aggregates()).where(*where)).one()
    return HoursReport(
        page=page,
        page_size=page_size,
        total=_n(total_groups),
        group_by=group_by,
        date_from=start,
        date_to=end,
        statuses=statuses,
        items=[
            ReportRow(
                key=str(r[0]),
                label=str(r[1]),
                detail=str(r[2]) if detail is not None else None,
                total_hours=_money(r[-5]),
                capped_hours=_money(r[-4]),
                non_capped_hours=_money(r[-3]),
                entry_count=_n(r[-2]),
                employee_count=_n(r[-1]),
            )
            for r in rows
        ],
        totals=ReportTotals(
            total_hours=_money(totals[0]),
            capped_hours=_money(totals[1]),
            non_capped_hours=_money(totals[2]),
            entry_count=_n(totals[3]),
            employee_count=_n(totals[4]),
        ),
    )


def safe_cell(value: object) -> str:
    """Neutralise spreadsheet formula injection: text that starts like a formula gets a quote."""
    text = str(value)
    return f"'{text}" if text.startswith(_FORMULA_PREFIXES) else text


def to_csv(report: HoursReport) -> str:
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\r\n")
    writer.writerow(
        ["Group", "Detail", "Total hours", "Capped hours", "Non-capped hours", "Entries", "People"]
    )
    for r in report.items:
        writer.writerow(
            [
                safe_cell(r.label),
                safe_cell(r.detail or ""),
                r.total_hours,
                r.capped_hours,
                r.non_capped_hours,
                r.entry_count,
                r.employee_count,
            ]
        )
    t = report.totals
    writer.writerow(
        [
            "Total",
            "",
            t.total_hours,
            t.capped_hours,
            t.non_capped_hours,
            t.entry_count,
            t.employee_count,
        ]
    )
    return out.getvalue()
