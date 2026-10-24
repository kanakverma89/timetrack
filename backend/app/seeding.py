"""Synthetic, idempotent seed data. Contains no real people, companies or credentials.

All rows use deterministic UUIDs (uuid5) so repeated runs update in place and tests/E2E can
rely on stable identifiers.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models import (
    ApprovalAction,
    ApprovalEvent,
    Classification,
    EarningCode,
    Project,
    ProjectTask,
    Role,
    Team,
    TeamMembership,
    TimeEntry,
    TimesheetWeek,
    User,
    WeekStatus,
)
from app.security.passwords import hash_password

NAMESPACE = uuid.UUID("6f1c2f3e-5d0b-4a39-9c1e-0a7a6c4b9e10")
MIN_PASSWORD_LENGTH = 12


def sid(*parts: str) -> uuid.UUID:
    return uuid.uuid5(NAMESPACE, "/".join(parts))


EMPLOYEE_EMAIL = "employee@example.test"
EMPLOYEE2_EMAIL = "employee2@example.test"
MANAGER_EMAIL = "manager@example.test"
MANAGER2_EMAIL = "manager2@example.test"
EMPLOYEE3_EMAIL = "employee3@example.test"
ADMIN_EMAIL = "admin@example.test"


@dataclass(frozen=True)
class SampleEntry:
    work_date: date
    hours: str
    earning: str
    project: str
    task: str | None
    description: str


def _d(value: str) -> date:
    return date.fromisoformat(value)


# employee@example.test, weeks start on Monday.
EMPLOYEE_WEEKS: dict[str, tuple[WeekStatus, list[SampleEntry]]] = {
    "2026-10-19": (
        WeekStatus.DRAFT,
        [
            SampleEntry(
                _d("2026-10-19"),
                "8.00",
                "REG",
                "PRJ-001",
                "DEV",
                "Sprint planning and implementation",
            ),
            SampleEntry(
                _d("2026-10-20"), "6.00", "REG", "PRJ-001", "REV", "Code review and pairing"
            ),
            SampleEntry(
                _d("2026-10-20"), "2.00", "TRN", "PRJ-003", None, "Security awareness training"
            ),
            SampleEntry(
                _d("2026-10-21"), "7.50", "REG", "PRJ-002", "IMP", "Portal feature implementation"
            ),
            SampleEntry(_d("2026-10-22"), "8.00", "REG", "PRJ-002", "DES", "Design iteration"),
            SampleEntry(_d("2026-10-23"), "2.50", "OVT", "PRJ-001", "DEV", "Production support"),
        ],
    ),
    "2026-10-12": (
        WeekStatus.DRAFT,
        [
            SampleEntry(
                _d(f"2026-10-{day}"), "8.00", "REG", "PRJ-001", "DEV", "Feature development"
            )
            for day in ("12", "13", "14", "15", "16")
        ],
    ),
    "2026-10-05": (
        WeekStatus.SUBMITTED,
        [
            SampleEntry(
                _d(f"2026-10-{day}"), "8.00", "REG", "PRJ-002", "IMP", "Portal implementation"
            )
            for day in ("05", "06", "07", "08")
        ],
    ),
    "2026-09-28": (
        WeekStatus.REJECTED,
        [
            SampleEntry(_d(f"2026-09-{day}"), "8.00", "REG", "PRJ-001", "TST", "Regression testing")
            for day in ("28", "29", "30")
        ],
    ),
}

EMPLOYEE3_WEEKS: dict[str, tuple[WeekStatus, list[SampleEntry]]] = {
    "2026-10-05": (
        WeekStatus.SUBMITTED,
        [
            SampleEntry(_d(f"2026-10-{day}"), "8.00", "REG", "PRJ-003", None, "Operations support")
            for day in ("05", "06", "07")
        ],
    ),
}

EMPLOYEE2_WEEKS: dict[str, tuple[WeekStatus, list[SampleEntry]]] = {
    "2026-10-19": (
        WeekStatus.DRAFT,
        [SampleEntry(_d("2026-10-19"), "4.00", "REG", "PRJ-003", None, "Operations handover")],
    ),
}


def _upsert_reference(db: Session) -> None:
    projects = [
        (
            "PRJ-001",
            "Platform Development",
            True,
            [("DEV", "Development"), ("REV", "Code Review"), ("TST", "Testing")],
        ),
        ("PRJ-002", "Customer Portal", True, [("DES", "Design"), ("IMP", "Implementation")]),
        ("PRJ-003", "Internal Operations", True, []),
        ("PRJ-900", "Archived Initiative", False, [("OLD", "Legacy Work")]),
    ]
    for code, name, active, tasks in projects:
        db.merge(Project(id=sid("project", code), code=code, name=name, is_active=active))
        db.flush()
        for task_code, task_name in tasks:
            db.merge(
                ProjectTask(
                    id=sid("task", code, task_code),
                    project_id=sid("project", code),
                    code=task_code,
                    name=task_name,
                    is_active=True,
                )
            )
    codes = [
        ("REG", "Regular Work", Classification.CAPPED, True),
        ("TRN", "Training", Classification.CAPPED, True),
        ("OVT", "Overtime", Classification.NON_CAPPED, True),
        ("PTO", "Paid Leave", Classification.NON_CAPPED, True),
        ("OLD", "Retired Code", Classification.CAPPED, False),
    ]
    for code, name, classification, active in codes:
        db.merge(
            EarningCode(
                id=sid("earning", code),
                code=code,
                name=name,
                classification=classification,
                is_active=active,
            )
        )
    db.flush()


def _upsert_users(db: Session, password: str) -> None:
    pw = hash_password(password)
    manager_id = sid("user", MANAGER_EMAIL)
    manager2_id = sid("user", MANAGER2_EMAIL)
    users = [
        (MANAGER_EMAIL, "Morgan Manager", Role.MANAGER, None),
        (MANAGER2_EMAIL, "Riley Manager", Role.MANAGER, None),
        (ADMIN_EMAIL, "Jordan Admin", Role.ADMIN, None),
        (EMPLOYEE_EMAIL, "Alex Employee", Role.EMPLOYEE, manager_id),
        (EMPLOYEE2_EMAIL, "Sam Employee", Role.EMPLOYEE, manager_id),
        # Reports to the *other* manager: lets tests prove managers only see their own reports.
        (EMPLOYEE3_EMAIL, "Taylor Employee", Role.EMPLOYEE, manager2_id),
    ]
    for email, name, role, mgr in users:
        db.merge(
            User(
                id=sid("user", email),
                email=email,
                display_name=name,
                role=role,
                manager_id=mgr,
                password_hash=pw,
                is_active=True,
            )
        )
        db.flush()
    db.merge(Team(id=sid("team", "platform"), name="Platform Team"))
    db.flush()
    for email in (MANAGER_EMAIL, EMPLOYEE_EMAIL, EMPLOYEE2_EMAIL):
        db.merge(TeamMembership(team_id=sid("team", "platform"), user_id=sid("user", email)))
    db.merge(Team(id=sid("team", "operations"), name="Operations Team"))
    db.flush()
    for email in (MANAGER2_EMAIL, EMPLOYEE3_EMAIL):
        db.merge(TeamMembership(team_id=sid("team", "operations"), user_id=sid("user", email)))
    db.flush()


def _upsert_weeks(
    db: Session,
    email: str,
    weeks: dict[str, tuple[WeekStatus, list[SampleEntry]]],
    manager_email: str = MANAGER_EMAIL,
) -> None:
    employee_id = sid("user", email)
    manager_id = sid("user", manager_email)
    for start_iso, (status, entries) in weeks.items():
        start = date.fromisoformat(start_iso)
        week_id = sid("week", email, start_iso)
        submitted = status in (WeekStatus.SUBMITTED, WeekStatus.REJECTED)
        db.merge(
            TimesheetWeek(
                id=week_id,
                employee_id=employee_id,
                week_start_date=start,
                week_end_date=date.fromordinal(start.toordinal() + 6),
                status=status,
                submitted_at=datetime(start.year, start.month, start.day, 12, tzinfo=UTC)
                if submitted
                else None,
                reviewed_at=datetime(start.year, start.month, start.day, 15, tzinfo=UTC)
                if status is WeekStatus.REJECTED
                else None,
                reviewed_by=manager_id if status is WeekStatus.REJECTED else None,
                review_comment="Please correct the hours recorded for Wednesday."
                if status is WeekStatus.REJECTED
                else None,
            )
        )
        db.flush()
        for index, e in enumerate(entries):
            db.merge(
                TimeEntry(
                    id=sid("entry", email, start_iso, str(index)),
                    timesheet_week_id=week_id,
                    employee_id=employee_id,
                    work_date=e.work_date,
                    hours=Decimal(e.hours),
                    earning_code_id=sid("earning", e.earning),
                    project_id=sid("project", e.project),
                    task_id=sid("task", e.project, e.task) if e.task else None,
                    description=e.description,
                )
            )
        db.flush()
        if submitted:
            db.merge(
                ApprovalEvent(
                    id=sid("event", email, start_iso, "submitted"),
                    timesheet_week_id=week_id,
                    actor_id=employee_id,
                    action=ApprovalAction.SUBMITTED,
                )
            )
        if status is WeekStatus.REJECTED:
            db.merge(
                ApprovalEvent(
                    id=sid("event", email, start_iso, "rejected"),
                    timesheet_week_id=week_id,
                    actor_id=manager_id,
                    action=ApprovalAction.REJECTED,
                    comment="Please correct the hours recorded for Wednesday.",
                )
            )
        db.flush()


def seed(db: Session, *, password: str, sample_entries: bool) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Seed password must be at least {MIN_PASSWORD_LENGTH} characters.")
    _upsert_reference(db)
    _upsert_users(db, password)
    if sample_entries:
        _upsert_weeks(db, EMPLOYEE_EMAIL, EMPLOYEE_WEEKS)
        _upsert_weeks(db, EMPLOYEE2_EMAIL, EMPLOYEE2_WEEKS)
        _upsert_weeks(db, EMPLOYEE3_EMAIL, EMPLOYEE3_WEEKS, MANAGER2_EMAIL)
    db.commit()
