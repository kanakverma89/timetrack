from __future__ import annotations

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models import (
    Classification,
    EarningCode,
    EntryAction,
    Project,
    ProjectTask,
    TimeEntry,
    TimeEntryEvent,
    TimesheetWeek,
    User,
    WeekStatus,
)
from app.tests.conftest import make_settings
from app.tests.factories import (
    PASSWORD,
    login,
    make_earning,
    make_entry,
    make_project,
    make_task,
    make_user,
    make_week,
)

API = "/api/v1"
MON = date(2026, 10, 19)  # Monday; the week runs to Sunday 2026-10-25


@dataclass
class World:
    user: User
    project: Project  # has one active task
    task: ProjectTask
    plain_project: Project  # no tasks
    earning: EarningCode
    overtime: EarningCode


@pytest.fixture
def world(db: Session) -> World:
    user = make_user(db)
    project = make_project(db, "P1")
    task = make_task(db, project, "T1")
    return World(
        user=user,
        project=project,
        task=task,
        plain_project=make_project(db, "P2"),
        earning=make_earning(db, "REG", Classification.CAPPED),
        overtime=make_earning(db, "OVT", Classification.NON_CAPPED),
    )


@pytest.fixture
def authed(client: TestClient, world: World) -> TestClient:
    login(client)
    return client


def payload(w: World, **overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "work_date": "2026-10-21",
        "hours": "8.00",
        "earning_code_id": str(w.earning.id),
        "project_id": str(w.project.id),
        "task_id": str(w.task.id),
        "description": "Implementation work",
    }
    body.update(overrides)
    return body


def count(db: Session, model: type) -> int:
    db.expire_all()
    return db.scalar(select(func.count()).select_from(model)) or 0


def week_view(client: TestClient, day: str = "2026-10-19") -> dict[str, Any]:
    response = client.get(f"{API}/timesheets/weeks/{day}")
    assert response.status_code == 200
    return response.json()  # type: ignore[no-any-return]


# ---------------------------------------------------------------------------------- create


def test_create_persists_entry_and_creates_the_draft_week(
    authed: TestClient, world: World, db: Session
) -> None:
    response = authed.post(f"{API}/time-entries", json=payload(world, hours="8.5"))
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["hours"] == "8.50"
    assert body["version"] == 1
    assert body["work_date"] == "2026-10-21"
    assert body["description"] == "Implementation work"
    assert body["project"]["code"] == "P1"
    assert body["task"]["code"] == "T1"
    assert body["earning_code"]["classification"] == "CAPPED"

    db.expire_all()
    week = db.scalars(select(TimesheetWeek)).one()
    assert (week.week_start_date, week.week_end_date) == (MON, date(2026, 10, 25))
    assert week.status is WeekStatus.DRAFT
    assert week.employee_id == world.user.id
    entry = db.scalars(select(TimeEntry)).one()
    assert entry.employee_id == world.user.id
    assert entry.timesheet_week_id == week.id

    view = week_view(authed)
    assert view["id"] == str(week.id)
    assert view["summary"]["total_hours"] == "8.50"
    assert view["summary"]["entry_count"] == 1
    assert {d["date"]: d["hours"] for d in view["daily_totals"]}["2026-10-21"] == "8.50"


def test_hours_may_be_sent_as_a_json_number(authed: TestClient, world: World) -> None:
    response = authed.post(f"{API}/time-entries", json=payload(world, hours=7.25))
    assert response.status_code == 201
    assert response.json()["hours"] == "7.25"


def test_entries_in_the_same_week_share_one_week_row(
    authed: TestClient, world: World, db: Session
) -> None:
    for day in ("2026-10-19", "2026-10-25"):  # Monday and Sunday of the same week
        assert (
            authed.post(f"{API}/time-entries", json=payload(world, work_date=day)).status_code
            == 201
        )
    assert count(db, TimesheetWeek) == 1
    assert week_view(authed)["summary"]["entry_count"] == 2


def test_entries_in_different_weeks_create_separate_weeks(
    authed: TestClient, world: World, db: Session
) -> None:
    for day in ("2026-10-25", "2026-10-26"):  # Sunday / next Monday
        assert (
            authed.post(f"{API}/time-entries", json=payload(world, work_date=day)).status_code
            == 201
        )
    assert count(db, TimesheetWeek) == 2


def test_boundaries_for_hours_are_accepted(authed: TestClient, world: World) -> None:
    for hours in ("0.01", "24", "24.00"):
        assert (
            authed.post(f"{API}/time-entries", json=payload(world, hours=hours)).status_code == 201
        )


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"hours": "0"}, "hours"),
        ({"hours": "-1"}, "hours"),
        ({"hours": "24.01"}, "hours"),
        ({"hours": "8.555"}, "hours"),
        ({"hours": "abc"}, "hours"),
        ({"hours": None}, "hours"),
        ({"description": ""}, "description"),
        ({"description": "   "}, "description"),
        ({"description": "x" * 257}, "description"),
        ({"work_date": "1969-12-31"}, "work_date"),
        ({"work_date": "2101-01-01"}, "work_date"),
        ({"work_date": "2026-02-30"}, "work_date"),
        ({"project_id": str(uuid.uuid4())}, "project_id"),
        ({"earning_code_id": str(uuid.uuid4())}, "earning_code_id"),
        ({"project_id": "not-a-uuid"}, "project_id"),
    ],
)
def test_invalid_input_is_rejected_with_a_field_error_and_persists_nothing(
    authed: TestClient, world: World, db: Session, overrides: dict[str, Any], field: str
) -> None:
    response = authed.post(f"{API}/time-entries", json=payload(world, **overrides))
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert field in error["field_errors"]
    assert count(db, TimeEntry) == 0
    assert count(db, TimesheetWeek) == 0  # no phantom week for a failed request


def test_error_messages_are_user_friendly(authed: TestClient, world: World) -> None:
    errors = authed.post(
        f"{API}/time-entries", json=payload(world, hours="0", description=" ")
    ).json()["error"]["field_errors"]
    assert errors == {
        "hours": "Hours must be greater than zero.",
        "description": "Description is required.",
    }


def test_all_problems_are_reported_together(authed: TestClient, world: World) -> None:
    errors = authed.post(
        f"{API}/time-entries",
        json=payload(world, hours="99", description="", task_id=None),
    ).json()["error"]["field_errors"]
    assert set(errors) == {"hours", "description", "task_id"}


def test_missing_required_fields_are_reported(authed: TestClient) -> None:
    response = authed.post(f"{API}/time-entries", json={})
    assert response.status_code == 422
    assert set(response.json()["error"]["field_errors"]) >= {
        "work_date",
        "hours",
        "earning_code_id",
        "project_id",
        "description",
    }


def test_configured_hour_limit_is_enforced(make_client: Any, test_url: Any, world: World) -> None:
    client = make_client(make_settings(test_url, max_hours_per_entry="12"))
    login(client)
    assert client.post(f"{API}/time-entries", json=payload(world, hours="12")).status_code == 201
    rejected = client.post(f"{API}/time-entries", json=payload(world, hours="12.5"))
    assert rejected.status_code == 422
    assert "12" in rejected.json()["error"]["field_errors"]["hours"]


def test_configured_description_limit_is_enforced(
    make_client: Any, test_url: Any, world: World
) -> None:
    client = make_client(make_settings(test_url, description_max_length=20))
    login(client)
    assert (
        client.post(f"{API}/time-entries", json=payload(world, description="x" * 20)).status_code
        == 201
    )
    assert (
        client.post(f"{API}/time-entries", json=payload(world, description="x" * 21)).status_code
        == 422
    )


def test_description_is_trimmed_and_stored_as_text(authed: TestClient, world: World) -> None:
    body = authed.post(
        f"{API}/time-entries", json=payload(world, description="  <b>bold</b> & more  ")
    ).json()
    assert body["description"] == "<b>bold</b> & more"


def test_client_supplied_owner_fields_are_refused(authed: TestClient, world: World) -> None:
    other = uuid.uuid4()
    for field in ("employee_id", "timesheet_week_id", "status", "version"):
        response = authed.post(f"{API}/time-entries", json=payload(world, **{field: str(other)}))
        assert response.status_code == 422, field


@pytest.mark.parametrize("inactive", ["project", "earning"])
def test_inactive_reference_data_is_rejected_for_new_entries(
    authed: TestClient, world: World, db: Session, inactive: str
) -> None:
    if inactive == "project":
        world.plain_project.is_active = False
        db.commit()
        body = payload(world, project_id=str(world.plain_project.id), task_id=None)
        expected = "project_id"
    else:
        world.overtime.is_active = False
        db.commit()
        body = payload(world, earning_code_id=str(world.overtime.id))
        expected = "earning_code_id"
    response = authed.post(f"{API}/time-entries", json=body)
    assert response.status_code == 422
    assert expected in response.json()["error"]["field_errors"]


def test_task_rules(authed: TestClient, world: World, db: Session) -> None:
    other_task = make_task(db, world.plain_project, "OTHER")
    inactive_task = make_task(db, world.project, "OLD", active=False)

    def post(**o: Any) -> Any:
        return authed.post(f"{API}/time-entries", json=payload(world, **o))

    # A task from another project is refused.
    assert "task_id" in post(task_id=str(other_task.id)).json()["error"]["field_errors"]
    # An inactive task is refused.
    assert "task_id" in post(task_id=str(inactive_task.id)).json()["error"]["field_errors"]
    # Unknown task.
    assert "task_id" in post(task_id=str(uuid.uuid4())).json()["error"]["field_errors"]
    # Required when the project has active tasks...
    required = post(task_id=None)
    assert required.status_code == 422
    assert required.json()["error"]["field_errors"]["task_id"] == "Select a task for this project."
    # ...but not when it has none,
    no_tasks = make_project(db, "NT")
    assert post(project_id=str(no_tasks.id), task_id=None).status_code == 201
    # ...nor when all of its tasks are inactive.
    world.task.is_active = False
    db.commit()
    assert post(task_id=None).status_code == 201


def test_task_given_for_a_project_with_no_tasks_is_refused(
    authed: TestClient, world: World
) -> None:
    response = authed.post(
        f"{API}/time-entries",
        json=payload(world, project_id=str(world.plain_project.id), task_id=str(world.task.id)),
    )
    assert response.status_code == 422
    assert "task_id" in response.json()["error"]["field_errors"]


def test_requires_authentication_and_csrf_header(
    client: TestClient, make_client: Any, settings: Any, world: World
) -> None:
    assert client.post(f"{API}/time-entries", json=payload(world)).status_code == 401
    login(client)
    no_csrf = make_client(settings, headers={})
    no_csrf.cookies.update(client.cookies)
    assert no_csrf.post(f"{API}/time-entries", json=payload(world)).status_code == 403


def test_create_writes_an_audit_event_without_the_description(
    authed: TestClient, world: World, db: Session
) -> None:
    secret_text = "confidential client details"
    body = authed.post(f"{API}/time-entries", json=payload(world, description=secret_text)).json()
    db.expire_all()
    event = db.scalars(select(TimeEntryEvent)).one()
    assert event.action is EntryAction.CREATED
    assert event.actor_id == world.user.id
    assert str(event.time_entry_id) == body["id"]
    assert event.details["hours"] == "8.00"
    assert event.details["project_id"] == str(world.project.id)
    assert secret_text not in str(event.details)


@pytest.mark.parametrize("status", [WeekStatus.SUBMITTED, WeekStatus.APPROVED])
def test_cannot_add_to_a_locked_week(
    authed: TestClient, world: World, db: Session, status: WeekStatus
) -> None:
    make_week(db, world.user, MON, status)
    response = authed.post(f"{API}/time-entries", json=payload(world))
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "WEEK_NOT_EDITABLE"
    assert count(db, TimeEntry) == 0


def test_rejected_week_stays_editable_and_keeps_its_status(
    authed: TestClient, world: World, db: Session
) -> None:
    make_week(db, world.user, MON, WeekStatus.REJECTED, review_comment="Fix Tuesday.")
    assert authed.post(f"{API}/time-entries", json=payload(world)).status_code == 201
    view = week_view(authed)
    assert view["status"] == "REJECTED"
    assert view["review_comment"] == "Fix Tuesday."


def test_concurrent_first_writes_create_exactly_one_week(
    client: TestClient, make_client: Any, settings: Any, world: World, db: Session
) -> None:
    workers = 6
    clients = []
    for _ in range(workers):
        c = make_client(settings)
        login(c)
        clients.append(c)
    barrier = threading.Barrier(workers)

    def run(c: TestClient) -> int:
        barrier.wait()
        return int(c.post(f"{API}/time-entries", json=payload(world)).status_code)

    with ThreadPoolExecutor(workers) as pool:
        statuses = list(pool.map(run, clients))
    assert statuses == [201] * workers
    assert count(db, TimesheetWeek) == 1
    assert count(db, TimeEntry) == workers


# ---------------------------------------------------------------------------------- update


def create(client: TestClient, w: World, **overrides: Any) -> dict[str, Any]:
    response = client.post(f"{API}/time-entries", json=payload(w, **overrides))
    assert response.status_code == 201, response.text
    return response.json()  # type: ignore[no-any-return]


def test_patch_updates_only_the_given_fields_and_totals_follow(
    authed: TestClient, world: World, db: Session
) -> None:
    entry = create(authed, world)
    response = authed.patch(f"{API}/time-entries/{entry['id']}", json={"hours": "6.25"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["hours"] == "6.25"
    assert body["description"] == "Implementation work"
    assert body["task"]["code"] == "T1"
    assert body["version"] == 2
    assert week_view(authed)["summary"]["total_hours"] == "6.25"

    db.expire_all()
    event = db.scalars(
        select(TimeEntryEvent).where(TimeEntryEvent.action == EntryAction.UPDATED)
    ).one()
    assert event.details["changes"] == {"hours": {"from": "8.00", "to": "6.25"}}
    assert event.details["description_changed"] is False


def test_patch_can_change_classification_via_earning_code(authed: TestClient, world: World) -> None:
    entry = create(authed, world)
    authed.patch(
        f"{API}/time-entries/{entry['id']}", json={"earning_code_id": str(world.overtime.id)}
    )
    summary = week_view(authed)["summary"]
    assert (summary["capped_hours"], summary["non_capped_hours"]) == ("0.00", "8.00")


def test_description_edit_is_audited_without_copying_the_text(
    authed: TestClient, world: World, db: Session
) -> None:
    entry = create(authed, world)
    authed.patch(f"{API}/time-entries/{entry['id']}", json={"description": "new private text"})
    db.expire_all()
    event = db.scalars(
        select(TimeEntryEvent).where(TimeEntryEvent.action == EntryAction.UPDATED)
    ).one()
    assert event.details == {"changes": {}, "description_changed": True}


def test_patch_with_identical_values_is_a_no_op(
    authed: TestClient, world: World, db: Session
) -> None:
    entry = create(authed, world)
    response = authed.patch(f"{API}/time-entries/{entry['id']}", json={"hours": "8.00"})
    assert response.status_code == 200
    assert response.json()["version"] == 1
    assert count(db, TimeEntryEvent) == 1  # only the CREATED event


def test_patch_can_move_the_date_within_the_same_week_only(
    authed: TestClient, world: World
) -> None:
    entry = create(authed, world)
    ok = authed.patch(f"{API}/time-entries/{entry['id']}", json={"work_date": "2026-10-25"})
    assert ok.status_code == 200
    assert ok.json()["work_date"] == "2026-10-25"
    moved = authed.patch(f"{API}/time-entries/{entry['id']}", json={"work_date": "2026-10-26"})
    assert moved.status_code == 422
    assert (
        "same week" not in moved.json()["error"]["field_errors"]["work_date"]
    )  # wording check below
    assert "within the entry's week" in moved.json()["error"]["field_errors"]["work_date"]
    assert week_view(authed)["entries"][0]["work_date"] == "2026-10-25"


def test_changing_project_requires_a_consistent_task(
    authed: TestClient, world: World, db: Session
) -> None:
    entry = create(authed, world)
    other = make_project(db, "P3")
    other_task = make_task(db, other, "X")

    # The old task does not belong to the new project, and a task is required there.
    bad = authed.patch(f"{API}/time-entries/{entry['id']}", json={"project_id": str(other.id)})
    assert bad.status_code == 422
    assert "task_id" in bad.json()["error"]["field_errors"]

    good = authed.patch(
        f"{API}/time-entries/{entry['id']}",
        json={"project_id": str(other.id), "task_id": str(other_task.id)},
    )
    assert good.status_code == 200
    assert good.json()["project"]["code"] == "P3"
    assert good.json()["task"]["code"] == "X"

    # Clearing the task of a project that has tasks is refused; a task-less project accepts null.
    cleared = authed.patch(f"{API}/time-entries/{entry['id']}", json={"task_id": None})
    assert cleared.status_code == 422
    plain = authed.patch(
        f"{API}/time-entries/{entry['id']}",
        json={"project_id": str(world.plain_project.id), "task_id": None},
    )
    assert plain.status_code == 200
    assert plain.json()["task"] is None


def test_unrelated_edit_of_a_legacy_entry_is_not_blocked_by_newer_rules(
    authed: TestClient, world: World, db: Session
) -> None:
    entry = create(authed, world, project_id=str(world.plain_project.id), task_id=None)
    make_task(db, world.plain_project, "NEW")  # the project gained tasks after the entry was made
    world.plain_project.is_active = False  # and was later retired
    db.commit()
    response = authed.patch(f"{API}/time-entries/{entry['id']}", json={"description": "Tidy up"})
    assert response.status_code == 200
    # A form that re-sends every (unchanged) field must not be blocked either.
    resend = authed.patch(
        f"{API}/time-entries/{entry['id']}",
        json={
            "work_date": entry["work_date"],
            "hours": "9",
            "project_id": entry["project"]["id"],
            "task_id": None,
            "earning_code_id": entry["earning_code"]["id"],
            "description": "Tidy up",
        },
    )
    assert resend.status_code == 200
    # ...but moving to an inactive project is still refused.
    switched = authed.patch(
        f"{API}/time-entries/{entry['id']}", json={"project_id": str(world.plain_project.id)}
    )
    assert switched.status_code == 200  # unchanged reference stays allowed
    other = make_project(db, "P9", active=False)
    refused = authed.patch(f"{API}/time-entries/{entry['id']}", json={"project_id": str(other.id)})
    assert refused.status_code == 422


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"hours": "0"}, "hours"),
        ({"hours": "30"}, "hours"),
        ({"description": " "}, "description"),
        ({"hours": None}, "hours"),
        ({"description": None}, "description"),
        ({}, "request"),
        ({"version": 1}, "request"),
        ({"employee_id": str(uuid.uuid4())}, "employee_id"),
    ],
)
def test_patch_validation(
    authed: TestClient, world: World, body: dict[str, Any], field: str
) -> None:
    entry = create(authed, world)
    response = authed.patch(f"{API}/time-entries/{entry['id']}", json=body)
    assert response.status_code == 422
    assert field in response.json()["error"]["field_errors"]
    assert week_view(authed)["entries"][0]["hours"] == "8.00"


def test_optimistic_concurrency_with_version(authed: TestClient, world: World) -> None:
    entry = create(authed, world)
    url = f"{API}/time-entries/{entry['id']}"
    assert authed.patch(url, json={"hours": "5", "version": 1}).status_code == 200
    stale = authed.patch(url, json={"hours": "4", "version": 1})
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "STALE_ENTRY"
    assert authed.patch(url, json={"hours": "4", "version": 2}).status_code == 200
    assert authed.patch(url, json={"hours": "3"}).status_code == 200  # version is optional
    assert week_view(authed)["entries"][0]["version"] == 4


def test_concurrent_updates_with_the_same_version_let_exactly_one_win(
    client: TestClient, make_client: Any, settings: Any, world: World
) -> None:
    login(client)
    entry = create(client, world)
    clients = []
    for _ in range(2):
        c = make_client(settings)
        login(c)
        clients.append(c)
    barrier = threading.Barrier(2)

    def run(args: tuple[TestClient, str]) -> int:
        c, hours = args
        barrier.wait()
        response = c.patch(f"{API}/time-entries/{entry['id']}", json={"hours": hours, "version": 1})
        return int(response.status_code)

    with ThreadPoolExecutor(2) as pool:
        statuses = sorted(pool.map(run, [(clients[0], "1"), (clients[1], "2")]))
    assert statuses == [200, 409]


def test_cannot_touch_another_employees_entry(
    client: TestClient, make_client: Any, settings: Any, world: World, db: Session
) -> None:
    login(client)
    entry = create(client, world)
    make_user(db, "intruder@example.test")
    intruder = make_client(settings)
    login(intruder, "intruder@example.test")

    url = f"{API}/time-entries/{entry['id']}"
    patched = intruder.patch(url, json={"hours": "1"})
    deleted = intruder.delete(url)
    missing = intruder.patch(f"{API}/time-entries/{uuid.uuid4()}", json={"hours": "1"})
    # Foreign and non-existent entries look identical (no enumeration).
    assert patched.status_code == deleted.status_code == missing.status_code == 404
    assert patched.json()["error"]["code"] == missing.json()["error"]["code"] == "NOT_FOUND"
    assert week_view(client)["entries"][0]["hours"] == "8.00"
    assert count(db, TimeEntry) == 1


def test_malformed_entry_id_is_a_validation_error(authed: TestClient) -> None:
    assert authed.patch(f"{API}/time-entries/nope", json={"hours": "1"}).status_code == 422
    assert authed.delete(f"{API}/time-entries/nope").status_code == 422


@pytest.mark.parametrize("status", [WeekStatus.SUBMITTED, WeekStatus.APPROVED])
def test_cannot_edit_or_delete_in_a_locked_week(
    authed: TestClient, world: World, db: Session, status: WeekStatus
) -> None:
    entry = create(authed, world)
    db.execute(update(TimesheetWeek).values(status=status))
    db.commit()
    url = f"{API}/time-entries/{entry['id']}"
    for response in (authed.patch(url, json={"hours": "1"}), authed.delete(url)):
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "WEEK_NOT_EDITABLE"
    db.expire_all()
    stored = db.scalars(select(TimeEntry)).one()
    assert str(stored.hours) == "8.00"


def test_editing_and_deleting_in_a_rejected_week_is_allowed(
    authed: TestClient, world: World, db: Session
) -> None:
    entry = create(authed, world)
    db.execute(update(TimesheetWeek).values(status=WeekStatus.REJECTED))
    db.commit()
    url = f"{API}/time-entries/{entry['id']}"
    assert authed.patch(url, json={"hours": "2"}).status_code == 200
    assert authed.delete(url).status_code == 204


# ---------------------------------------------------------------------------------- delete


def test_delete_removes_entry_updates_totals_and_keeps_week_and_audit(
    authed: TestClient, world: World, db: Session
) -> None:
    keep = create(authed, world, hours="3")
    gone = create(authed, world, hours="5", work_date="2026-10-22")
    assert week_view(authed)["summary"]["total_hours"] == "8.00"

    assert authed.delete(f"{API}/time-entries/{gone['id']}").status_code == 204
    view = week_view(authed)
    assert [e["id"] for e in view["entries"]] == [keep["id"]]
    assert view["summary"]["total_hours"] == "3.00"
    assert {d["date"]: d["hours"] for d in view["daily_totals"]}["2026-10-22"] == "0.00"

    db.expire_all()
    assert count(db, TimesheetWeek) == 1
    deleted_event = db.scalars(
        select(TimeEntryEvent).where(TimeEntryEvent.action == EntryAction.DELETED)
    ).one()
    assert str(deleted_event.time_entry_id) == gone["id"]
    assert deleted_event.details["hours"] == "5.00"
    assert authed.delete(f"{API}/time-entries/{gone['id']}").status_code == 404  # already gone


def test_other_employees_totals_are_unaffected(
    client: TestClient, make_client: Any, settings: Any, world: World, db: Session
) -> None:
    login(client)
    create(client, world, hours="4")
    make_user(db, "other@example.test")
    other = make_client(settings)
    login(other, "other@example.test")
    create(other, world, hours="7")
    assert week_view(client)["summary"]["total_hours"] == "4.00"
    assert week_view(other)["summary"]["total_hours"] == "7.00"


def test_login_password_constant_is_not_logged_in_audit(world: World, db: Session) -> None:
    # Guard: audit rows never contain credentials or free text.
    assert PASSWORD not in str(db.scalars(select(TimeEntryEvent)).all())


def test_existing_week_entry_helper_still_works(db: Session, world: World) -> None:
    week = make_week(db, world.user, MON)
    entry = make_entry(db, week, world.project, world.earning, MON, "2.00", task=world.task)
    assert entry.version == 1
