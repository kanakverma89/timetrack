from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response

from app.core.logging import logger
from app.models import Role, WeekStatus
from app.schemas.report import GroupBy, HoursReport
from app.security.dependencies import CurrentUser, DbDep, require_roles
from app.services import reports

# Managers see their assigned employees, administrators everyone; employees have no reports.
router = APIRouter(
    prefix="/reports",
    tags=["reports"],
    dependencies=[Depends(require_roles(Role.MANAGER, Role.ADMIN))],
)

StatusQuery = Annotated[list[WeekStatus] | None, Query(alias="status")]


def _run(
    db: DbDep,
    user: CurrentUser,
    date_from: date,
    date_to: date,
    group_by: GroupBy,
    status: list[WeekStatus] | None,
    employee_id: uuid.UUID | None,
    project_id: uuid.UUID | None,
    page: int,
    page_size: int,
) -> HoursReport:
    return reports.run_report(
        db,
        user,
        start=date_from,
        end=date_to,
        group_by=group_by,
        statuses=status or [WeekStatus.APPROVED],
        employee_id=employee_id,
        project_id=project_id,
        page=page,
        page_size=page_size,
    )


@router.get("/hours", response_model=HoursReport)
def hours_report(
    user: CurrentUser,
    db: DbDep,
    date_from: date,
    date_to: date,
    group_by: GroupBy = GroupBy.EMPLOYEE,
    status: StatusQuery = None,
    employee_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> HoursReport:
    return _run(
        db, user, date_from, date_to, group_by, status, employee_id, project_id, page, page_size
    )


@router.get("/hours.csv")
def hours_csv(
    user: CurrentUser,
    db: DbDep,
    date_from: date,
    date_to: date,
    group_by: GroupBy = GroupBy.EMPLOYEE,
    status: StatusQuery = None,
    employee_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
) -> Response:
    """The same report as a CSV download (not paged; capped at 100,000 rows)."""
    report = reports.run_report(
        db,
        user,
        start=date_from,
        end=date_to,
        group_by=group_by,
        statuses=status or [WeekStatus.APPROVED],
        employee_id=employee_id,
        project_id=project_id,
        page=1,
        page_size=reports.MAX_EXPORT_ROWS,
    )
    # Exports carry personal data: record that one happened (who/what, never the contents).
    logger.info(
        "report_exported",
        extra={
            "actor_id": str(user.id),
            "group_by": group_by.value,
            "date_from": date_from.isoformat(),
            "date_to": date_to.isoformat(),
            "rows": len(report.items),
        },
    )
    return Response(
        content=reports.to_csv(report),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="hours-{date_from}-{date_to}.csv"',
            "Cache-Control": "no-store",
        },
    )
