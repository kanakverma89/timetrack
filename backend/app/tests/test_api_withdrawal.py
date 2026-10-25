"""POST /timesheets/weeks/{date}/withdraw: SUBMITTED -> DRAFT while no manager has decided yet."""

# The `org` fixture is shared with the approvals tests; pytest needs it imported by name, which
# ruff reads as redefinition when a test then takes it as a parameter.
# ruff: noqa: F811

from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    ApprovalAction,
    ApprovalEvent,
    NotificationOutbox,
    OutboxStatus,
    TimesheetWeek,
    WeekStatus,
)
from app.tests.support import API, World, count, payload, week_view
from app.tests.test_api_approvals import (  # noqa: F401
    DAY,
    Org,
    approve,
    listing,
    org,
    reject,
    submit_week,
)


def withdraw(client: TestClient, day: str = DAY) -> Any:
    return client.post(f"{API}/timesheets/weeks/{day}/withdraw")


def actions(db: Session) -> list[ApprovalAction]:
    db.expire_all()
    rows = db.scalars(select(ApprovalEvent).order_by(ApprovalEvent.created_at)).all()
    return [row.action for row in rows]


# ---------------------------------------------------------------------------- success


def test_withdrawing_a_submitted_week_makes_it_an_editable_draft(
    org: Org, world: World, db: Session
) -> None:
    submit_week(org.emp, world)

    response = withdraw(org.emp)

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["status"], body["is_editable"], body["submitted_at"]) == ("DRAFT", True, None)
    assert body["summary"]["entry_count"] == 1  # nothing is lost
    row = db.scalars(select(TimesheetWeek)).one()
    db.refresh(row)
    assert row.status is WeekStatus.DRAFT and row.submitted_at is None
    assert actions(db) == [ApprovalAction.SUBMITTED, ApprovalAction.WITHDRAWN]
    event = db.scalars(
        select(ApprovalEvent).where(ApprovalEvent.action == ApprovalAction.WITHDRAWN)
    ).one()
    assert event.actor_id == org.employee.id and event.timesheet_week_id == row.id


def test_the_week_can_be_edited_and_resubmitted_after_withdrawal(
    org: Org, world: World, db: Session
) -> None:
    submit_week(org.emp, world)
    withdraw(org.emp)

    added = org.emp.post(
        f"{API}/time-entries", json=payload(world, work_date="2026-10-20", hours="2")
    )
    assert added.status_code == 201, added.text

    again = org.emp.post(f"{API}/timesheets/weeks/{DAY}/submit", json={})
    assert again.status_code == 200, again.text
    assert again.json()["summary"]["total_hours"] == "10.00"
    assert actions(db) == [
        ApprovalAction.SUBMITTED,
        ApprovalAction.WITHDRAWN,
        ApprovalAction.SUBMITTED,
    ]


def test_a_withdrawn_week_leaves_the_review_queue_and_is_hidden_from_the_manager(
    org: Org, world: World
) -> None:
    week_id = submit_week(org.emp, world)
    assert [i["week_id"] for i in listing(org.mgr).json()["items"]] == [week_id]

    withdraw(org.emp)

    assert listing(org.mgr).json()["items"] == []
    assert org.mgr.get(f"{API}/approvals/{week_id}").status_code == 404
    assert approve(org.mgr, week_id).status_code == 404
    assert reject(org.mgr, week_id).status_code == 404


def test_withdrawal_notifies_the_manager_with_ids_only(org: Org, world: World, db: Session) -> None:
    week_id = submit_week(org.emp, world)
    withdraw(org.emp)

    outbox = db.scalars(
        select(NotificationOutbox).where(NotificationOutbox.event_type == "TIMESHEET_WITHDRAWN")
    ).one()
    db.refresh(outbox)
    assert outbox.status is OutboxStatus.SENT
    assert outbox.payload == {
        "week_id": week_id,
        "employee_id": str(org.employee.id),
        "manager_id": str(org.manager.id),
        "week_start_date": DAY,
    }
    assert ("TIMESHEET_WITHDRAWN", outbox.payload) in org.port.sent


def test_any_date_in_the_week_selects_that_week(org: Org, world: World) -> None:
    submit_week(org.emp, world)
    assert withdraw(org.emp, "2026-10-23").json()["week_start_date"] == DAY


# ---------------------------------------------------------------------------- refusals


def test_a_draft_week_cannot_be_withdrawn(org: Org, world: World, db: Session) -> None:
    org.emp.post(f"{API}/time-entries", json=payload(world, work_date=DAY, hours="8"))

    response = withdraw(org.emp)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "INVALID_TRANSITION"
    assert "nothing to withdraw" in response.json()["error"]["message"]
    assert actions(db) == []


def test_an_approved_week_cannot_be_withdrawn(org: Org, world: World, db: Session) -> None:
    week_id = submit_week(org.emp, world)
    assert approve(org.mgr, week_id).status_code == 200

    response = withdraw(org.emp)

    assert response.status_code == 409
    assert "already been approved" in response.json()["error"]["message"]
    assert week_view(org.emp)["status"] == "APPROVED"
    assert actions(db) == [ApprovalAction.SUBMITTED, ApprovalAction.APPROVED]


def test_a_rejected_week_cannot_be_withdrawn(org: Org, world: World) -> None:
    week_id = submit_week(org.emp, world)
    assert reject(org.mgr, week_id).status_code == 200

    response = withdraw(org.emp)

    assert response.status_code == 409
    assert "already open for editing" in response.json()["error"]["message"]


def test_withdrawing_twice_is_a_conflict_not_a_second_event(
    org: Org, world: World, db: Session
) -> None:
    submit_week(org.emp, world)
    assert withdraw(org.emp).status_code == 200

    assert withdraw(org.emp).status_code == 409
    assert actions(db).count(ApprovalAction.WITHDRAWN) == 1


def test_a_week_that_does_not_exist_is_not_found(org: Org) -> None:
    assert withdraw(org.emp, "2031-01-05").status_code == 404


def test_nobody_can_withdraw_someone_elses_week(org: Org, world: World, db: Session) -> None:
    week_id = submit_week(org.emp, world)

    for other in (org.mgr, org.adm, org.out):
        assert withdraw(other).status_code == 404  # they have no such week of their own

    assert org.mgr.post(f"{API}/approvals/{week_id}/withdraw").status_code in (404, 405)
    assert week_view(org.emp)["status"] == "SUBMITTED"
    assert actions(db) == [ApprovalAction.SUBMITTED]


def test_a_session_and_the_csrf_header_are_required(
    org: Org, world: World, client: TestClient
) -> None:
    submit_week(org.emp, world)

    assert withdraw(client).status_code == 401

    no_header = org.emp.post(
        f"{API}/timesheets/weeks/{DAY}/withdraw", headers={"X-Requested-With": ""}
    )
    assert no_header.status_code == 403
    assert week_view(org.emp)["status"] == "SUBMITTED"


def test_unsupported_dates_are_rejected(org: Org) -> None:
    response = withdraw(org.emp, "1850-01-05")
    assert response.status_code == 422
    assert "week_start_date" in response.json()["error"]["field_errors"]


# ------------------------------------------------------------------------ concurrency


def test_a_withdrawal_and_a_decision_at_the_same_moment_cannot_both_win(
    org: Org, world: World, db: Session, make_client: Any, settings: Any
) -> None:
    week_id = submit_week(org.emp, world)
    emp2 = make_client(settings, org.port)
    emp2.cookies.update(org.emp.cookies)
    mgr2 = make_client(settings, org.port)
    mgr2.cookies.update(org.mgr.cookies)
    barrier = threading.Barrier(2)

    def run(job: str) -> tuple[str, int]:
        barrier.wait()
        response = withdraw(emp2) if job == "withdraw" else approve(mgr2, week_id)
        return job, int(response.status_code)

    with ThreadPoolExecutor(2) as pool:
        outcome = dict(pool.map(run, ["withdraw", "approve"]))

    db.expire_all()
    final = db.scalars(select(TimesheetWeek)).one().status
    if outcome["withdraw"] == 200:
        assert final is WeekStatus.DRAFT
        assert outcome["approve"] in (404, 409)  # hidden once it is a draft
        assert actions(db) == [ApprovalAction.SUBMITTED, ApprovalAction.WITHDRAWN]
    else:
        assert outcome == {"withdraw": 409, "approve": 200}
        assert final is WeekStatus.APPROVED
        assert actions(db) == [ApprovalAction.SUBMITTED, ApprovalAction.APPROVED]
    assert count(db, ApprovalEvent) == 2
