"""Week mode: POST /time-entries/batch creates several dated entries for one week atomically."""

from __future__ import annotations

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    EntryAction,
    TimeEntry,
    TimeEntryEvent,
    TimesheetWeek,
    WeekStatus,
)
from app.tests.factories import login, make_entry, make_week
from app.tests.support import API, World, count, payload, week_view

MON = date(2026, 10, 19)


def day(offset: int) -> str:
    return (MON + timedelta(days=offset)).isoformat()


def batch(w: World, days: dict[int, str], **shared: Any) -> dict[str, Any]:
    """A batch body: one entry per {day offset: hours}, all sharing the other fields."""
    return {"entries": [payload(w, work_date=day(d), hours=h, **shared) for d, h in days.items()]}


def post(client: TestClient, body: dict[str, Any]) -> Any:
    return client.post(f"{API}/time-entries/batch", json=body)


def errors(response: Any) -> dict[str, str]:
    return response.json()["error"]["field_errors"]  # type: ignore[no-any-return]


# ------------------------------------------------------------------------------- success


def test_creates_one_entry_per_day_and_returns_entries_and_summary(
    authed: TestClient, world: World, db: Session
) -> None:
    response = post(authed, batch(world, {0: "8", 1: "6.5", 4: "4.25"}, description="Sprint work"))
    assert response.status_code == 201, response.text
    body = response.json()

    assert [e["work_date"] for e in body["entries"]] == [day(0), day(1), day(4)]
    assert [e["hours"] for e in body["entries"]] == ["8.00", "6.50", "4.25"]
    assert len({e["id"] for e in body["entries"]}) == 3  # each created record is identifiable
    assert all(e["version"] == 1 and e["description"] == "Sprint work" for e in body["entries"])
    assert body["summary"] == {
        "total_hours": "18.75",
        "capped_hours": "18.75",
        "non_capped_hours": "0.00",
        "entry_count": 3,
        "draft_count": 3,
    }
    daily = {d["date"]: d["hours"] for d in body["daily_totals"]}
    assert (daily[day(0)], daily[day(1)], daily[day(2)], daily[day(4)]) == (
        "8.00",
        "6.50",
        "0.00",
        "4.25",
    )
    assert len(body["daily_totals"]) == 7

    db.expire_all()
    assert db.scalars(select(TimesheetWeek)).one().week_start_date == MON
    events = db.scalars(select(TimeEntryEvent)).all()
    assert len(events) == 3
    assert {e.action for e in events} == {EntryAction.CREATED}
    assert {e.actor_id for e in events} == {world.user.id}
    assert week_view(authed)["summary"]["total_hours"] == "18.75"  # matches the persisted state


def test_total_is_exact_decimal_arithmetic(authed: TestClient, world: World) -> None:
    body = post(authed, batch(world, {0: "0.10", 1: "0.20"})).json()
    assert body["summary"]["total_hours"] == "0.30"


def test_a_full_seven_day_week_and_classification(authed: TestClient, world: World) -> None:
    body = post(
        authed,
        batch(world, dict.fromkeys(range(7), "7.5"), earning_code_id=str(world.overtime.id)),
    ).json()
    assert body["summary"]["total_hours"] == "52.50"
    assert body["summary"]["non_capped_hours"] == "52.50"
    assert body["summary"]["capped_hours"] == "0.00"


def test_existing_entries_are_never_replaced(authed: TestClient, world: World, db: Session) -> None:
    week = make_week(db, world.user, MON)
    make_entry(db, week, world.project, world.earning, MON, "3.00", description="Already here")
    response = post(authed, batch(world, {0: "2", 1: "2"}))
    assert response.status_code == 201
    view = week_view(authed)
    assert view["summary"]["entry_count"] == 3
    assert {d["date"]: d["hours"] for d in view["daily_totals"]}[day(0)] == "5.00"
    assert "Already here" in [e["description"] for e in view["entries"]]


def test_sunday_and_monday_of_one_week_boundary(authed: TestClient, world: World) -> None:
    # Sunday 2026-10-25 closes the week that started Monday 2026-10-19.
    assert post(authed, batch(world, {0: "1", 6: "1"})).status_code == 201


def test_rejected_week_accepts_a_batch_and_keeps_its_status(
    authed: TestClient, world: World, db: Session
) -> None:
    make_week(db, world.user, MON, WeekStatus.REJECTED, review_comment="Fix it.")
    assert post(authed, batch(world, {0: "1"})).status_code == 201
    assert week_view(authed)["status"] == "REJECTED"


# ----------------------------------------------------------------------------- atomicity


def test_one_invalid_item_rejects_the_whole_batch_and_persists_nothing(
    authed: TestClient, world: World, db: Session
) -> None:
    body = batch(world, {0: "8", 1: "6", 2: "0", 3: "4"})  # third item has zero hours
    response = post(authed, body)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert errors(response) == {"entries.2.hours": "Hours must be greater than zero."}
    assert count(db, TimeEntry) == 0
    assert count(db, TimesheetWeek) == 0  # not even an empty week row
    assert count(db, TimeEntryEvent) == 0
    # The valid days really were fine on their own: the failing one alone is the only problem.
    body["entries"].pop(2)
    assert post(authed, body).status_code == 201


def test_every_failing_item_is_reported_together(authed: TestClient, world: World) -> None:
    response = (
        post(authed, batch(world, {0: "25", 1: "8", 2: "7.555", 3: "abc-not-used"}))
        if False
        else None
    )
    body = batch(world, {0: "25", 1: "8", 2: "7.555"})
    response = post(authed, body)
    assert response.status_code == 422
    assert set(errors(response)) == {"entries.0.hours", "entries.2.hours"}


def test_shared_field_problems_are_reported_on_each_item(
    authed: TestClient, world: World, db: Session
) -> None:
    world.plain_project.is_active = False
    db.commit()
    response = post(
        authed,
        batch(world, {0: "1", 1: "1"}, project_id=str(world.plain_project.id), task_id=None),
    )
    assert response.status_code == 422
    assert set(errors(response)) == {"entries.0.project_id", "entries.1.project_id"}
    assert count(db, TimeEntry) == 0


def test_task_rules_apply_to_batches(authed: TestClient, world: World) -> None:
    missing = post(authed, batch(world, {0: "1"}, task_id=None))
    assert errors(missing) == {"entries.0.task_id": "Select a task for this project."}
    foreign = post(
        authed,
        batch(world, {0: "1"}, project_id=str(world.plain_project.id)),  # task belongs to P1
    )
    assert "entries.0.task_id" in errors(foreign)


def test_all_dates_must_be_in_the_same_week(authed: TestClient, world: World, db: Session) -> None:
    response = post(authed, batch(world, {0: "1", 7: "1"}))  # Monday, then next Monday
    assert response.status_code == 422
    assert errors(response) == {
        "entries.1.work_date": "All dates in a batch must be in the same week."
    }
    assert count(db, TimeEntry) == 0
    assert count(db, TimesheetWeek) == 0


def test_a_date_may_appear_only_once(authed: TestClient, world: World) -> None:
    body = {
        "entries": [
            payload(world, work_date=day(1), hours="1"),
            payload(world, work_date=day(2), hours="1"),
            payload(world, work_date=day(1), hours="2"),
        ]
    }
    response = post(authed, body)
    assert response.status_code == 422
    assert errors(response) == {"entries.2.work_date": "Each date can only appear once in a batch."}


def test_unsupported_dates_are_reported_per_item(authed: TestClient, world: World) -> None:
    body = {
        "entries": [
            payload(world, work_date=day(0)),
            payload(world, work_date="1900-01-01"),
        ]
    }
    response = post(authed, body)
    assert response.status_code == 422
    assert "entries.1.work_date" in errors(response)


@pytest.mark.parametrize(
    "body",
    [
        {"entries": []},
        {},
        {"entries": "nope"},
        {"entries": [{"work_date": "2026-10-19"}]},  # missing required fields
    ],
)
def test_malformed_batches_are_validation_errors(
    authed: TestClient, world: World, db: Session, body: dict[str, Any]
) -> None:
    response = post(authed, body)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert count(db, TimeEntry) == 0


def test_batch_size_is_capped(authed: TestClient, world: World) -> None:
    items = [payload(world, work_date=day(0), hours="1") for _ in range(32)]
    response = post(authed, {"entries": items})
    assert response.status_code == 422
    assert "entries" in errors(response)


def test_owner_fields_are_refused_at_both_levels(authed: TestClient, world: World) -> None:
    stranger = str(uuid.uuid4())
    top = batch(world, {0: "1"})
    top["employee_id"] = stranger
    assert post(authed, top).status_code == 422
    item = batch(world, {0: "1"})
    item["entries"][0]["employee_id"] = stranger
    assert post(authed, item).status_code == 422


def test_a_failure_part_way_through_the_transaction_rolls_everything_back(
    make_client: Any,
    settings: Any,
    world: World,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = make_client(settings, raise_server_exceptions=False)
    login(client)
    from app.repositories import timesheets as repository

    real = repository.add_entry_event
    calls = {"n": 0}

    def flaky(*args: Any, **kwargs: Any) -> None:
        calls["n"] += 1
        if calls["n"] == 3:
            raise RuntimeError("simulated database failure")
        real(*args, **kwargs)

    monkeypatch.setattr(repository, "add_entry_event", flaky)
    response = post(client, batch(world, {0: "1", 1: "2", 2: "3", 3: "4"}))
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "INTERNAL_ERROR"
    assert "simulated" not in response.text
    # Two rows had already been inserted when it failed: none may survive, nor the new week.
    assert count(db, TimeEntry) == 0
    assert count(db, TimesheetWeek) == 0
    assert count(db, TimeEntryEvent) == 0


# --------------------------------------------------------------------------- access rules


@pytest.mark.parametrize("status", [WeekStatus.SUBMITTED, WeekStatus.APPROVED])
def test_locked_week_refuses_the_whole_batch(
    authed: TestClient, world: World, db: Session, status: WeekStatus
) -> None:
    make_week(db, world.user, MON, status)
    response = post(authed, batch(world, {0: "1", 1: "1"}))
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "WEEK_NOT_EDITABLE"
    assert count(db, TimeEntry) == 0


def test_requires_session_and_csrf_header(
    client: TestClient, make_client: Any, settings: Any, world: World
) -> None:
    assert post(client, batch(world, {0: "1"})).status_code == 401
    login(client)
    bare = make_client(settings, headers={})
    bare.cookies.update(client.cookies)
    assert post(bare, batch(world, {0: "1"})).status_code == 403


def test_a_batch_only_ever_touches_the_callers_own_week(
    client: TestClient, make_client: Any, settings: Any, world: World, db: Session
) -> None:
    from app.tests.factories import make_user

    login(client)
    make_user(db, "other@example.test")
    other = make_client(settings)
    login(other, "other@example.test")
    assert post(other, batch(world, {0: "5"})).status_code == 201
    assert post(client, batch(world, {0: "2"})).status_code == 201
    assert week_view(client)["summary"]["total_hours"] == "2.00"
    assert week_view(other)["summary"]["total_hours"] == "5.00"
    assert count(db, TimesheetWeek) == 2


def test_concurrent_batches_on_one_new_week_create_one_week_and_lose_nothing(
    client: TestClient, make_client: Any, settings: Any, world: World, db: Session
) -> None:
    workers = 4
    clients = []
    for _ in range(workers):
        c = make_client(settings)
        login(c)
        clients.append(c)
    barrier = threading.Barrier(workers)

    def run(args: tuple[int, TestClient]) -> int:
        index, c = args
        barrier.wait()
        return int(post(c, batch(world, {index: "1"})).status_code)

    with ThreadPoolExecutor(workers) as pool:
        statuses = list(pool.map(run, enumerate(clients)))
    assert statuses == [201] * workers
    assert count(db, TimesheetWeek) == 1
    assert count(db, TimeEntry) == workers
    db.expire_all()
    assert {w.status for w in db.scalars(select(TimesheetWeek))} == {WeekStatus.DRAFT}
