"""Constraints enforced by PostgreSQL itself, independent of application code."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.orm import Session

from app.models import Role, TimeEntry, TimesheetWeek, User
from app.tests.factories import (
    make_earning,
    make_entry,
    make_project,
    make_task,
    make_user,
    make_week,
)

MON = date(2026, 10, 19)


@pytest.fixture
def world(db: Session):  # type: ignore[no-untyped-def]
    user = make_user(db)
    project = make_project(db, "P1")
    earning = make_earning(db)
    week = make_week(db, user, MON)
    return user, project, earning, week


def _assert_violation(db: Session, fn) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises((IntegrityError, DataError)):
        fn()
    db.rollback()


@pytest.mark.parametrize("hours", ["0", "-1.00", "24.01"])
def test_hours_must_be_positive_and_at_most_24(db: Session, world, hours: str) -> None:  # type: ignore[no-untyped-def]
    _, project, earning, week = world
    _assert_violation(db, lambda: make_entry(db, week, project, earning, MON, hours))


def test_hours_are_stored_with_two_decimal_places(db: Session, world) -> None:  # type: ignore[no-untyped-def]
    _, project, earning, week = world
    entry = make_entry(db, week, project, earning, MON, "7.255")
    db.refresh(entry)
    assert entry.hours == Decimal("7.26")  # NUMERIC(5,2) rounds half away from zero
    assert entry.hours.as_tuple().exponent == -2


def test_description_required_and_bounded(db: Session, world) -> None:  # type: ignore[no-untyped-def]
    _, project, earning, week = world
    _assert_violation(db, lambda: make_entry(db, week, project, earning, MON, description="   "))
    _assert_violation(
        db, lambda: make_entry(db, week, project, earning, MON, description="x" * 257)
    )
    make_entry(db, week, project, earning, MON, description="x" * 256)


def test_entry_owner_must_match_week_owner(db: Session, world) -> None:  # type: ignore[no-untyped-def]
    _, project, earning, week = world
    other = make_user(db, "other@example.test")
    _assert_violation(db, lambda: make_entry(db, week, project, earning, MON, employee_id=other.id))


def test_task_must_belong_to_entry_project(db: Session, world) -> None:  # type: ignore[no-untyped-def]
    _, project, earning, week = world
    other_project = make_project(db, "P2")
    foreign_task = make_task(db, other_project, "X")
    own_task = make_task(db, project, "Y")
    _assert_violation(db, lambda: make_entry(db, week, project, earning, MON, task=foreign_task))
    make_entry(db, week, project, earning, MON, task=own_task)
    make_entry(db, week, project, earning, MON, task=None)


def test_week_must_span_exactly_seven_days(db: Session, world) -> None:  # type: ignore[no-untyped-def]
    user = world[0]

    def add() -> None:
        db.add(
            TimesheetWeek(
                employee_id=user.id,
                week_start_date=MON + timedelta(days=7),
                week_end_date=MON + timedelta(days=15),
            )
        )
        db.commit()

    _assert_violation(db, add)


def test_one_week_row_per_employee_and_start_date(db: Session, world) -> None:  # type: ignore[no-untyped-def]
    user = world[0]
    _assert_violation(db, lambda: make_week(db, user, MON))


def test_unique_codes(db: Session, world) -> None:  # type: ignore[no-untyped-def]
    _assert_violation(db, lambda: make_project(db, "P1"))
    make_project(db, "P9")
    project = make_project(db, "P10")
    make_task(db, project, "T")
    _assert_violation(db, lambda: make_task(db, project, "T"))


def test_user_email_must_be_lowercase_and_unique(db: Session) -> None:
    def add_upper() -> None:
        db.add(User(email="Upper@Example.test", display_name="U", role=Role.EMPLOYEE))
        db.commit()

    _assert_violation(db, add_upper)
    make_user(db, "a@example.test")
    _assert_violation(db, lambda: make_user(db, "a@example.test"))


def test_enum_columns_are_constrained(db: Session, world) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(IntegrityError):
        db.execute(text("UPDATE timesheet_weeks SET status = 'BOGUS'"))
    db.rollback()


def test_week_with_entries_cannot_be_deleted(db: Session, world) -> None:  # type: ignore[no-untyped-def]
    _, project, earning, week = world
    make_entry(db, week, project, earning, MON)
    with pytest.raises(IntegrityError):
        db.execute(text("DELETE FROM timesheet_weeks"))
    db.rollback()


def test_entries_model_roundtrip(db: Session, world) -> None:  # type: ignore[no-untyped-def]
    _, project, earning, week = world
    entry = make_entry(db, week, project, earning, MON, "1.50")
    loaded = db.get(TimeEntry, entry.id)
    assert loaded is not None and loaded.version == 1
