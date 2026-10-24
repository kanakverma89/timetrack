"""POST /timesheets/weeks/{date}/submit: lifecycle, validation, audit, outbox, idempotency."""

from __future__ import annotations

import logging
import threading
from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models import (
    ApprovalAction,
    ApprovalEvent,
    IdempotencyKey,
    NotificationOutbox,
    OutboxStatus,
    TimeEntry,
    TimesheetWeek,
    User,
    WeekStatus,
)
from app.services import notifications
from app.tests.conftest import make_settings
from app.tests.factories import login, make_user
from app.tests.support import API, World, count, payload, week_view

KEY = "retry-key-0001"


def submit(
    client: TestClient,
    day: str = "2026-10-19",
    *,
    key: str | None = None,
    body: dict[str, Any] | None = None,
) -> Any:
    headers = {"Idempotency-Key": key} if key else {}
    return client.post(
        f"{API}/timesheets/weeks/{day}/submit", json={} if body is None else body, headers=headers
    )


def add(client: TestClient, w: World, day: str = "2026-10-19", hours: str = "8", **kw: Any) -> Any:
    response = client.post(f"{API}/time-entries", json=payload(w, work_date=day, hours=hours, **kw))
    assert response.status_code == 201, response.text
    return response.json()


def week_row(db: Session) -> TimesheetWeek:
    db.expire_all()
    return db.scalars(select(TimesheetWeek)).one()


class RecordingPort:
    def __init__(self) -> None:
        self.sent: list[tuple[str, Mapping[str, object]]] = []

    def send(self, event_type: str, payload: Mapping[str, object]) -> None:
        self.sent.append((event_type, payload))


class FailingPort:
    def __init__(self) -> None:
        self.calls = 0

    def send(self, event_type: str, payload: Mapping[str, object]) -> None:
        self.calls += 1
        raise ConnectionError("provider down (token=secret-token-123)")


# --------------------------------------------------------------------------- success


def test_submitting_a_valid_week_locks_it_and_records_everything(
    authed: TestClient, world: World, db: Session
) -> None:
    add(authed, world, hours="8")
    add(authed, world, day="2026-10-20", hours="6.5")
    before = datetime.now(UTC)

    response = submit(authed, body={"comment": "  Ready for review  "})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "SUBMITTED"
    assert body["is_editable"] is False
    assert body["summary"]["total_hours"] == "14.50"
    assert body["summary"]["draft_count"] == 0
    assert before - timedelta(seconds=1) <= datetime.fromisoformat(body["submitted_at"])
    assert datetime.fromisoformat(body["submitted_at"]) <= datetime.now(UTC) + timedelta(seconds=1)

    row = week_row(db)
    assert row.status is WeekStatus.SUBMITTED and row.submitted_at is not None
    event = db.scalars(select(ApprovalEvent)).one()
    assert (event.action, event.actor_id, event.comment) == (
        ApprovalAction.SUBMITTED,
        world.user.id,
        "Ready for review",
    )
    assert event.timesheet_week_id == row.id
    assert week_view(authed)["status"] == "SUBMITTED"  # and it is what a later read shows


def test_any_date_in_the_week_selects_that_week(authed: TestClient, world: World) -> None:
    add(authed, world)
    assert submit(authed, "2026-10-23").json()["week_start_date"] == "2026-10-19"


def test_resubmitting_a_rejected_week_works_and_clears_the_old_decision(
    authed: TestClient, world: World, db: Session
) -> None:
    manager = make_user(db, "boss@example.test")
    add(authed, world)
    db.execute(
        update(TimesheetWeek).values(
            status=WeekStatus.REJECTED,
            reviewed_by=manager.id,
            reviewed_at=datetime.now(UTC),
            review_comment="Fix Tuesday",
        )
    )
    db.commit()
    assert week_view(authed)["review_comment"] == "Fix Tuesday"

    response = submit(authed)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "SUBMITTED"
    assert (body["review_comment"], body["reviewed_at"]) == (None, None)
    outbox = db.scalars(select(NotificationOutbox)).one()
    assert outbox.payload["resubmission"] is True


# ------------------------------------------------------------------------- validation


def test_a_week_without_entries_cannot_be_submitted(
    authed: TestClient, world: World, db: Session
) -> None:
    response = submit(authed)
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "BUSINESS_RULE_VIOLATION"
    assert error["field_errors"] == {"entries": "Add at least one time entry before submitting."}
    assert count(db, TimesheetWeek) == 0  # submitting must never create a week

    add(authed, world)
    authed.delete(f"{API}/time-entries/{week_view(authed)['entries'][0]['id']}")
    assert submit(authed).status_code == 422  # a week row that is now empty
    assert week_row(db).status is WeekStatus.DRAFT


def test_other_peoples_entries_never_count(
    client: TestClient, make_client: Any, settings: Any, world: World, db: Session
) -> None:
    login(client)
    add(client, world)
    make_user(db, "other@example.test")
    other = make_client(settings)
    login(other, "other@example.test")
    assert submit(other).status_code == 422  # nothing of their own to submit
    assert week_view(client)["status"] == "DRAFT"  # and the first user's week is untouched
    assert count(db, ApprovalEvent) == 0


@pytest.mark.parametrize("status", [WeekStatus.SUBMITTED, WeekStatus.APPROVED])
def test_only_draft_or_rejected_weeks_can_be_submitted(
    authed: TestClient, world: World, db: Session, status: WeekStatus
) -> None:
    add(authed, world)
    db.execute(update(TimesheetWeek).values(status=status))
    db.commit()
    response = submit(authed)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "INVALID_TRANSITION"
    assert count(db, ApprovalEvent) == 0
    assert count(db, NotificationOutbox) == 0


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"comment": "x" * 501}, "comment"),
        ({"comment": 5}, "comment"),
        ({"employee_id": "x"}, "employee_id"),
        ({"status": "APPROVED"}, "status"),
    ],
)
def test_request_body_is_validated(
    authed: TestClient, world: World, db: Session, body: dict[str, Any], field: str
) -> None:
    add(authed, world)
    response = submit(authed, body=body)
    assert response.status_code == 422
    assert field in response.json()["error"]["field_errors"]
    assert week_row(db).status is WeekStatus.DRAFT


def test_missing_body_is_allowed_and_bad_dates_are_rejected(
    authed: TestClient, world: World
) -> None:
    add(authed, world)
    assert authed.post(f"{API}/timesheets/weeks/2026-10-19/submit").status_code == 200
    for bad in ("not-a-date", "2026-02-30", "1900-01-01", "9999-12-31"):
        assert authed.post(f"{API}/timesheets/weeks/{bad}/submit", json={}).status_code == 422


def test_requires_session_and_csrf_header(
    client: TestClient, make_client: Any, settings: Any, world: World
) -> None:
    assert submit(client).status_code == 401
    login(client)
    add(client, world)
    bare = make_client(settings, headers={})
    bare.cookies.update(client.cookies)
    assert submit(bare).status_code == 403
    assert week_view(client)["status"] == "DRAFT"


def test_stored_entries_are_rechecked_against_current_limits(
    make_client: Any, test_url: Any, world: World
) -> None:
    client = make_client(make_settings(test_url))
    login(client)
    first = add(client, world, hours="8")
    add(client, world, day="2026-10-20", hours="5")
    # The per-entry maximum is tightened after the entries were written.
    strict = make_client(make_settings(test_url, max_hours_per_entry="6"))
    strict.cookies.update(client.cookies)
    response = submit(strict)
    assert response.status_code == 422
    assert list(response.json()["error"]["field_errors"]) == [f"entries.{first['id']}.hours"]
    assert week_view(client)["status"] == "DRAFT"


# ---------------------------------------------------------------------- weekly policy


def test_configured_policy_blocks_submission_and_is_reported_clearly(
    make_client: Any, test_url: Any, world: World, db: Session
) -> None:
    client = make_client(make_settings(test_url, max_hours_per_day="10", max_hours_per_week="30"))
    login(client)
    add(client, world, day="2026-10-20", hours="9")
    add(client, world, day="2026-10-20", hours="8")  # 17 on one day
    add(client, world, day="2026-10-21", hours="10")
    add(client, world, day="2026-10-22", hours="10")  # 37 for the week
    response = submit(client)
    assert response.status_code == 422
    errors = response.json()["error"]["field_errors"]
    assert set(errors) == {"day.2026-10-20", "week"}
    assert "17.00" in errors["day.2026-10-20"] and "37.00" in errors["week"]
    assert week_row(db).status is WeekStatus.DRAFT
    assert count(db, ApprovalEvent) == 0

    # Correcting the data lets the same week through.
    entries = week_view(client)["entries"]
    client.delete(f"{API}/time-entries/{entries[0]['id']}")  # remove the 9h entry
    client.delete(f"{API}/time-entries/{entries[3]['id']}")  # and one 10h entry
    assert submit(client).status_code == 200


def test_without_configured_limits_there_is_no_policy(authed: TestClient, world: World) -> None:
    for offset in range(7):
        add(authed, world, day=f"2026-10-{19 + offset}", hours="24")
    assert submit(authed).status_code == 200  # 168 hours: allowed because nobody set a rule


# ----------------------------------------------------------------- after submission


def test_entries_cannot_be_changed_after_submission(
    authed: TestClient, world: World, db: Session
) -> None:
    entry = add(authed, world)
    assert submit(authed).status_code == 200
    url = f"{API}/time-entries/{entry['id']}"
    attempts = [
        authed.post(f"{API}/time-entries", json=payload(world)),
        authed.post(
            f"{API}/time-entries/batch", json={"entries": [payload(world, work_date="2026-10-20")]}
        ),
        authed.patch(url, json={"hours": "1"}),
        authed.delete(url),
    ]
    for response in attempts:
        assert response.status_code == 409, response.text
        assert response.json()["error"]["code"] == "WEEK_NOT_EDITABLE"
    db.expire_all()
    stored = db.scalars(select(TimeEntry)).one()
    assert str(stored.hours) == "8.00"


# ------------------------------------------------------------------- duplicate safety


def test_a_second_submission_is_a_conflict_and_changes_nothing(
    authed: TestClient, world: World, db: Session
) -> None:
    add(authed, world)
    assert submit(authed).status_code == 200
    again = submit(authed)
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "INVALID_TRANSITION"
    assert count(db, ApprovalEvent) == 1
    assert count(db, NotificationOutbox) == 1


def test_retrying_with_the_same_idempotency_key_returns_the_result_not_an_error(
    authed: TestClient, world: World, db: Session
) -> None:
    add(authed, world)
    first = submit(authed, key=KEY)
    retry = submit(authed, key=KEY)
    assert (first.status_code, retry.status_code) == (200, 200)
    assert retry.json()["status"] == "SUBMITTED"
    assert retry.json()["submitted_at"] == first.json()["submitted_at"]
    assert count(db, ApprovalEvent) == 1
    assert count(db, NotificationOutbox) == 1
    assert count(db, IdempotencyKey) == 1


def test_an_idempotency_key_cannot_be_reused_for_another_week(
    authed: TestClient, world: World, db: Session
) -> None:
    add(authed, world)
    add(authed, world, day="2026-10-26")
    assert submit(authed, "2026-10-19", key=KEY).status_code == 200
    other = submit(authed, "2026-10-26", key=KEY)
    assert other.status_code == 422
    assert "Idempotency-Key" in other.json()["error"]["field_errors"]
    assert week_view(authed, "2026-10-26")["status"] == "DRAFT"


def test_idempotency_keys_are_per_user(
    client: TestClient, make_client: Any, settings: Any, world: World, db: Session
) -> None:
    login(client)
    add(client, world)
    make_user(db, "other@example.test")
    other = make_client(settings)
    login(other, "other@example.test")
    add(other, world)
    assert submit(client, key=KEY).status_code == 200
    assert submit(other, key=KEY).status_code == 200  # same string, different person: independent
    assert count(db, ApprovalEvent) == 2


@pytest.mark.parametrize("key", ["short", "has space in it", "x" * 101, "bad/slash/key1"])
def test_malformed_idempotency_keys_are_rejected(
    authed: TestClient, world: World, key: str
) -> None:
    add(authed, world)
    response = submit(authed, key=key)
    assert response.status_code == 422
    assert "Idempotency-Key" in response.json()["error"]["field_errors"]


def test_concurrent_submissions_produce_exactly_one_transition(
    client: TestClient, make_client: Any, settings: Any, world: World, db: Session
) -> None:
    login(client)
    add(client, world)
    workers = 6
    clients = []
    for _ in range(workers):
        c = make_client(settings)
        c.cookies.update(client.cookies)
        clients.append(c)
    barrier = threading.Barrier(workers)

    def run(c: TestClient) -> int:
        barrier.wait()
        return int(submit(c).status_code)

    with ThreadPoolExecutor(workers) as pool:
        statuses = sorted(pool.map(run, clients))
    assert statuses == [200] + [409] * (workers - 1)
    assert count(db, ApprovalEvent) == 1
    assert count(db, NotificationOutbox) == 1


def test_concurrent_retries_with_one_key_all_succeed_but_act_once(
    client: TestClient, make_client: Any, settings: Any, world: World, db: Session
) -> None:
    login(client)
    add(client, world)
    workers = 6
    clients = []
    for _ in range(workers):
        c = make_client(settings)
        c.cookies.update(client.cookies)
        clients.append(c)
    barrier = threading.Barrier(workers)

    def run(c: TestClient) -> int:
        barrier.wait()
        return int(submit(c, key=KEY).status_code)

    with ThreadPoolExecutor(workers) as pool:
        statuses = list(pool.map(run, clients))
    assert statuses == [200] * workers
    assert count(db, ApprovalEvent) == 1
    assert count(db, NotificationOutbox) == 1


def test_a_failure_while_submitting_changes_nothing(
    make_client: Any,
    settings: Any,
    world: World,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = make_client(settings, raise_server_exceptions=False)
    login(client)
    add(client, world)

    def boom(*args: Any, **kwargs: Any) -> None:
        raise RuntimeError("simulated failure after the status was already changed")

    monkeypatch.setattr(notifications, "enqueue", boom)
    response = submit(client, key=KEY)
    assert response.status_code == 500
    assert "simulated" not in response.text
    # Status, audit event and idempotency key were all written before the failure: none may stay.
    assert week_row(db).status is WeekStatus.DRAFT
    assert count(db, ApprovalEvent) == 0
    assert count(db, IdempotencyKey) == 0
    monkeypatch.undo()
    assert submit(client, key=KEY).status_code == 200  # and the same retry then succeeds


# ------------------------------------------------------------------------ notifications


def test_the_manager_notification_is_enqueued_delivered_and_minimal(
    make_client: Any, settings: Any, world: World, db: Session
) -> None:
    port = RecordingPort()
    manager = make_user(db, "boss@example.test")
    db.execute(update(User).where(User.id == world.user.id).values(manager_id=manager.id))
    db.commit()
    client = make_client(settings, port)
    login(client)
    add(client, world, description="Very confidential client detail")
    submit(client, body={"comment": "private note to the manager"})

    row = db.scalars(select(NotificationOutbox)).one()
    db.refresh(row)
    assert row.event_type == "TIMESHEET_SUBMITTED"
    assert row.status is OutboxStatus.SENT and row.attempt_count == 1
    assert row.processed_at is not None and row.last_error is None
    assert row.payload == {
        "week_id": str(week_row(db).id),
        "employee_id": str(world.user.id),
        "manager_id": str(manager.id),
        "week_start_date": "2026-10-19",
        "entry_count": 1,
        "total_hours": "8.00",
        "resubmission": False,
    }
    assert port.sent == [("TIMESHEET_SUBMITTED", row.payload)]
    text = str(row.payload)
    assert "confidential" not in text and "private note" not in text


def test_a_failing_provider_never_fails_the_request_and_is_retried_then_parked(
    make_client: Any, settings: Any, world: World, db: Session
) -> None:
    port = FailingPort()
    client = make_client(settings, port)
    login(client)
    add(client, world)
    response = submit(client)
    assert response.status_code == 200  # delivery problems are not the user's problem

    row = db.scalars(select(NotificationOutbox)).one()
    db.refresh(row)
    assert (row.status, row.attempt_count) == (OutboxStatus.PENDING, 1)
    assert row.last_error and row.last_error.startswith("ConnectionError")

    factory = client.app.state.session_factory
    for _ in range(2):
        notifications.process_pending(factory, port, max_attempts=3)
    db.refresh(row)
    assert (row.status, row.attempt_count) == (OutboxStatus.FAILED, 3)
    notifications.process_pending(factory, port, max_attempts=3)  # parked rows are left alone
    assert port.calls == 3


def test_process_pending_delivers_each_row_once(
    authed: TestClient, world: World, db: Session
) -> None:
    add(authed, world)
    submit(authed)
    row = db.scalars(select(NotificationOutbox)).one()
    db.refresh(row)
    assert row.status is OutboxStatus.SENT
    port = RecordingPort()
    factory = authed.app.state.session_factory  # type: ignore[attr-defined]
    assert notifications.process_pending(factory, port, max_attempts=3) == 0
    assert port.sent == []


def test_the_development_adapter_logs_identifiers_but_no_free_text(
    make_client: Any, test_url: Any, world: World
) -> None:
    records: list[logging.LogRecord] = []

    class Capture(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            records.append(record)

    # create_app() reconfigures logging, so attach the capture handler afterwards.
    client = make_client(make_settings(test_url, log_level="INFO"))
    handler = Capture()
    logging.getLogger("timetrack").addHandler(handler)
    try:
        login(client)
        add(client, world, description="top secret description")
        submit(client, body={"comment": "top secret comment"}, key=KEY)
    finally:
        logging.getLogger("timetrack").removeHandler(handler)
    dispatched = [r for r in records if r.getMessage() == "notification_dispatched"]
    assert len(dispatched) == 1
    everything = " ".join(f"{r.getMessage()} {r.__dict__}" for r in records)
    assert "top secret" not in everything
    assert KEY not in everything
    assert getattr(dispatched[0], "event_type") == "TIMESHEET_SUBMITTED"  # noqa: B009


def test_week_count_of_approval_events_matches_submissions_over_a_resubmission(
    authed: TestClient, world: World, db: Session
) -> None:
    add(authed, world)
    submit(authed)
    db.execute(update(TimesheetWeek).values(status=WeekStatus.REJECTED))
    db.commit()
    submit(authed)
    events = db.scalars(select(ApprovalEvent).order_by(ApprovalEvent.created_at)).all()
    assert [e.action for e in events] == [ApprovalAction.SUBMITTED, ApprovalAction.SUBMITTED]
    assert db.scalar(select(func.count()).select_from(NotificationOutbox)) == 2
