from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import Classification, TimesheetWeek, WeekStatus
from app.tests.conftest import make_settings
from app.tests.factories import (
    login,
    make_earning,
    make_entry,
    make_project,
    make_task,
    make_user,
    make_week,
)

API = "/api/v1"
MON = date(2026, 10, 19)


def get_week(client: TestClient, day: str) -> dict[str, Any]:
    response = client.get(f"{API}/timesheets/weeks/{day}")
    assert response.status_code == 200, response.text
    return response.json()  # type: ignore[no-any-return]


def test_requires_authentication(client: TestClient) -> None:
    response = client.get(f"{API}/timesheets/weeks/2026-10-19")
    assert response.status_code == 401


def test_empty_week_is_a_draft_with_seven_zero_days_and_nothing_is_written(
    client: TestClient, db: Session
) -> None:
    make_user(db)
    login(client)
    first = get_week(client, "2026-10-19")
    second = get_week(client, "2026-10-19")
    assert first == second
    assert first["id"] is None
    assert first["status"] == "DRAFT"
    assert first["is_editable"] is True
    assert (first["week_start_date"], first["week_end_date"]) == ("2026-10-19", "2026-10-25")
    assert [d["date"] for d in first["daily_totals"]] == [
        (MON + timedelta(days=i)).isoformat() for i in range(7)
    ]
    assert {d["hours"] for d in first["daily_totals"]} == {"0.00"}
    assert first["summary"] == {
        "total_hours": "0.00",
        "capped_hours": "0.00",
        "non_capped_hours": "0.00",
        "entry_count": 0,
        "draft_count": 0,
    }
    assert first["entries"] == []
    # GET must be side-effect free (no duplicate/phantom week rows).
    assert db.scalar(select(func.count()).select_from(TimesheetWeek)) == 0


@pytest.mark.parametrize(
    ("given", "expected_start", "expected_end"),
    [
        ("2026-10-21", "2026-10-19", "2026-10-25"),
        ("2026-10-25", "2026-10-19", "2026-10-25"),
        ("2026-10-26", "2026-10-26", "2026-11-01"),  # month boundary
        ("2026-01-01", "2025-12-29", "2026-01-04"),  # year boundary
        ("2024-02-29", "2024-02-26", "2024-03-03"),  # leap day
    ],
)
def test_any_date_is_normalised_to_its_week(
    client: TestClient, db: Session, given: str, expected_start: str, expected_end: str
) -> None:
    make_user(db)
    login(client)
    body = get_week(client, given)
    assert (body["week_start_date"], body["week_end_date"]) == (expected_start, expected_end)


def test_totals_classification_ordering_and_entry_shape(client: TestClient, db: Session) -> None:
    user = make_user(db)
    project = make_project(db, "PRJ-1", name="Platform")
    task = make_task(db, project, "DEV")
    reg = make_earning(db, "REG", Classification.CAPPED)
    ovt = make_earning(db, "OVT", Classification.NON_CAPPED)
    week = make_week(db, user, MON)
    make_entry(
        db, week, project, reg, date(2026, 10, 21), "7.25", task=task, description="Later day"
    )
    make_entry(db, week, project, reg, MON, "8.00", description="First day")
    make_entry(db, week, project, ovt, MON, "1.50", description="Overtime")
    login(client)

    body = get_week(client, "2026-10-19")
    assert body["id"] == str(week.id)
    assert body["summary"] == {
        "total_hours": "16.75",
        "capped_hours": "15.25",
        "non_capped_hours": "1.50",
        "entry_count": 3,
        "draft_count": 3,
    }
    daily = {d["date"]: d["hours"] for d in body["daily_totals"]}
    assert daily["2026-10-19"] == "9.50"
    assert daily["2026-10-21"] == "7.25"
    assert daily["2026-10-20"] == "0.00"
    # Server-side daily totals add up to the weekly total.
    assert sum(float(h) for h in daily.values()) == pytest.approx(16.75)

    assert [e["work_date"] for e in body["entries"]] == ["2026-10-19", "2026-10-19", "2026-10-21"]
    last = body["entries"][-1]
    assert last["hours"] == "7.25"
    assert last["description"] == "Later day"
    assert last["project"] == {"id": str(project.id), "code": "PRJ-1", "name": "Platform"}
    assert last["task"] == {"id": str(task.id), "code": "DEV", "name": "Task DEV"}
    assert last["earning_code"]["classification"] == "CAPPED"
    assert body["entries"][0]["task"] is None


def test_never_returns_another_employees_data(client: TestClient, db: Session) -> None:
    me = make_user(db, "me@example.test")
    other = make_user(db, "other@example.test")
    project, earning = make_project(db), make_earning(db)
    mine = make_week(db, me, MON)
    theirs = make_week(db, other, MON)
    make_entry(db, mine, project, earning, MON, "3.00", description="mine")
    make_entry(db, theirs, project, earning, MON, "9.00", description="secret of other")
    login(client, "me@example.test")

    body = get_week(client, "2026-10-19")
    assert body["id"] == str(mine.id)
    assert body["summary"]["total_hours"] == "3.00"
    assert "secret of other" not in str(body)

    # And with no rows of my own, the other person's week must not leak either.
    empty = get_week(client, "2026-10-26")
    assert empty["id"] is None


def test_submitted_week_is_read_only_and_has_no_draft_entries(
    client: TestClient, db: Session
) -> None:
    user = make_user(db)
    project, earning = make_project(db), make_earning(db)
    submitted_at = datetime(2026, 10, 9, 12, 0, tzinfo=UTC)
    week = make_week(db, user, MON, WeekStatus.SUBMITTED, submitted_at=submitted_at)
    make_entry(db, week, project, earning, MON, "8.00")
    login(client)
    body = get_week(client, "2026-10-19")
    assert body["status"] == "SUBMITTED"
    assert body["is_editable"] is False
    assert body["summary"]["draft_count"] == 0
    assert body["summary"]["entry_count"] == 1
    assert body["submitted_at"].startswith("2026-10-09T12:00:00")


def test_rejected_week_exposes_reason_and_is_editable(client: TestClient, db: Session) -> None:
    employee = make_user(db)
    manager = make_user(db, "mgr@example.test")
    project, earning = make_project(db), make_earning(db)
    week = make_week(
        db,
        employee,
        MON,
        WeekStatus.REJECTED,
        reviewed_by=manager.id,
        review_comment="Please correct Tuesday.",
    )
    make_entry(db, week, project, earning, MON, "8.00")
    login(client)
    body = get_week(client, "2026-10-19")
    assert body["status"] == "REJECTED"
    assert body["review_comment"] == "Please correct Tuesday."
    assert body["is_editable"] is True
    assert body["summary"]["draft_count"] == 1


@pytest.mark.parametrize("bad", ["not-a-date", "2026-13-01", "2026-02-30", "20261019"])
def test_invalid_dates_are_validation_errors(client: TestClient, db: Session, bad: str) -> None:
    make_user(db)
    login(client)
    response = client.get(f"{API}/timesheets/weeks/{bad}")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize("far", ["1900-01-01", "9999-12-31", "0001-01-01"])
def test_dates_outside_supported_range_are_rejected_without_server_error(
    client: TestClient, db: Session, far: str
) -> None:
    make_user(db)
    login(client)
    response = client.get(f"{API}/timesheets/weeks/{far}")
    assert response.status_code == 422
    assert "week_start_date" in response.json()["error"]["field_errors"]


def test_sunday_week_start_is_configurable(make_client, test_url, db: Session) -> None:  # type: ignore[no-untyped-def]
    make_user(db)
    client = make_client(make_settings(test_url, week_start_day="SUNDAY"))
    login(client)
    body = get_week(client, "2026-10-24")  # Saturday
    assert (body["week_start_date"], body["week_end_date"]) == ("2026-10-18", "2026-10-24")


def test_entries_dated_outside_requested_week_are_not_included(
    client: TestClient, db: Session
) -> None:
    user = make_user(db)
    project, earning = make_project(db), make_earning(db)
    this_week = make_week(db, user, MON)
    next_week = make_week(db, user, MON + timedelta(days=7))
    make_entry(db, this_week, project, earning, MON, "1.00")
    make_entry(db, next_week, project, earning, MON + timedelta(days=7), "2.00")
    login(client)
    assert get_week(client, "2026-10-19")["summary"]["total_hours"] == "1.00"
    assert get_week(client, "2026-10-26")["summary"]["total_hours"] == "2.00"


def test_settings_fixture_is_isolated(settings: Settings) -> None:
    assert settings.app_env == "test"
