from __future__ import annotations

import uuid
from datetime import date, timedelta
from decimal import Decimal
from functools import lru_cache

from sqlalchemy.orm import Session

from app.models import (
    Classification,
    EarningCode,
    Project,
    ProjectTask,
    Role,
    TimeEntry,
    TimesheetWeek,
    User,
    WeekStatus,
)
from app.security.passwords import hash_password

PASSWORD = "correct-horse-battery-staple"  # noqa: S105 - test-only value


@lru_cache
def _hash() -> str:
    return hash_password(PASSWORD)


def make_user(
    db: Session,
    email: str = "emp@example.test",
    role: Role = Role.EMPLOYEE,
    *,
    active: bool = True,
    password: str | None = PASSWORD,
) -> User:
    user = User(
        email=email,
        display_name=email.split("@")[0].title(),
        role=role,
        is_active=active,
        password_hash=_hash() if password == PASSWORD else None,
    )
    db.add(user)
    db.commit()
    return user


def make_project(
    db: Session, code: str = "P1", *, active: bool = True, name: str | None = None
) -> Project:
    project = Project(code=code, name=name or f"Project {code}", is_active=active)
    db.add(project)
    db.commit()
    return project


def make_task(
    db: Session, project: Project, code: str = "T1", *, active: bool = True
) -> ProjectTask:
    task = ProjectTask(project_id=project.id, code=code, name=f"Task {code}", is_active=active)
    db.add(task)
    db.commit()
    return task


def make_earning(
    db: Session,
    code: str = "REG",
    classification: Classification = Classification.CAPPED,
    *,
    active: bool = True,
) -> EarningCode:
    earning = EarningCode(
        code=code, name=f"Earning {code}", classification=classification, is_active=active
    )
    db.add(earning)
    db.commit()
    return earning


def make_week(
    db: Session,
    employee: User,
    start: date,
    status: WeekStatus = WeekStatus.DRAFT,
    **extra: object,
) -> TimesheetWeek:
    week = TimesheetWeek(
        employee_id=employee.id,
        week_start_date=start,
        week_end_date=start + timedelta(days=6),
        status=status,
        **extra,
    )
    db.add(week)
    db.commit()
    return week


def make_entry(
    db: Session,
    week: TimesheetWeek,
    project: Project,
    earning: EarningCode,
    work_date: date,
    hours: str = "8.00",
    *,
    task: ProjectTask | None = None,
    description: str = "Work",
    employee_id: uuid.UUID | None = None,
) -> TimeEntry:
    entry = TimeEntry(
        timesheet_week_id=week.id,
        employee_id=employee_id or week.employee_id,
        work_date=work_date,
        hours=Decimal(hours),
        earning_code_id=earning.id,
        project_id=project.id,
        task_id=task.id if task else None,
        description=description,
    )
    db.add(entry)
    db.commit()
    return entry


def login(client: object, email: str = "emp@example.test", password: str = PASSWORD) -> None:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})  # type: ignore[attr-defined]
    assert response.status_code == 200, response.text
