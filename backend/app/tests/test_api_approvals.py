"""Manager review: scope, list, detail, approve, reject, audit (spec §8.7, Phase 6)."""

from __future__ import annotations

import threading
import uuid
from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.models import (
    ApprovalAction,
    ApprovalEvent,
    IdempotencyKey,
    NotificationOutbox,
    OutboxStatus,
    Role,
    TimesheetWeek,
    User,
    WeekStatus,
)
from app.repositories import approvals as approvals_repo
from app.services import notifications, review_policy
from app.tests.factories import login, make_user
from app.tests.support import API, World, count, payload, week_view

KEY = "decision-key-0001"
DAY = "2026-10-19"
REASON = "Please correct the hours recorded for Tuesday."


class RecordingPort:
    def __init__(self) -> None:
        self.sent: list[tuple[str, Mapping[str, object]]] = []

    def send(self, event_type: str, payload: Mapping[str, object]) -> None:
        self.sent.append((event_type, payload))


class FailingPort:
    def send(self, event_type: str, payload: Mapping[str, object]) -> None:
        raise ConnectionError("provider down")


@dataclass
class Org:
    employee: User
    manager: User  # assigned to `employee`
    other_manager: User  # assigned to `outsider`
    admin: User
    outsider: User
    emp: TestClient
    mgr: TestClient
    mgr2: TestClient
    adm: TestClient
    out: TestClient
    port: RecordingPort


@pytest.fixture
def org(world: World, db: Session, make_client: Any, settings: Any) -> Org:
    manager = make_user(db, "mgr@example.test", Role.MANAGER)
    other_manager = make_user(db, "mgr2@example.test", Role.MANAGER)
    admin = make_user(db, "adm@example.test", Role.ADMIN)
    outsider = make_user(db, "out@example.test")
    world.user.manager_id = manager.id
    outsider.manager_id = other_manager.id
    db.commit()
    port = RecordingPort()

    def client(email: str) -> TestClient:
        c: TestClient = make_client(settings, port)
        login(c, email)
        return c

    return Org(
        employee=world.user,
        manager=manager,
        other_manager=other_manager,
        admin=admin,
        outsider=outsider,
        emp=client("emp@example.test"),
        mgr=client("mgr@example.test"),
        mgr2=client("mgr2@example.test"),
        adm=client("adm@example.test"),
        out=client("out@example.test"),
        port=port,
    )


def submit_week(client: TestClient, w: World, day: str = DAY, hours: str = "8") -> str:
    """Add one entry in the week and submit it; returns the week id."""
    added = client.post(f"{API}/time-entries", json=payload(w, work_date=day, hours=hours))
    assert added.status_code == 201, added.text
    response = client.post(
        f"{API}/timesheets/weeks/{day}/submit", json={"comment": "Please review"}
    )
    assert response.status_code == 200, response.text
    return str(response.json()["id"])


def approve(c: TestClient, week_id: str, **kw: Any) -> Any:
    body = {"comment": kw.pop("comment")} if "comment" in kw else {}
    headers = {"Idempotency-Key": kw["key"]} if kw.get("key") else {}
    return c.post(f"{API}/approvals/{week_id}/approve", json=body, headers=headers)


def reject(
    c: TestClient, week_id: str, comment: str | None = REASON, key: str | None = None
) -> Any:
    body: dict[str, Any] = {} if comment is None else {"comment": comment}
    headers = {"Idempotency-Key": key} if key else {}
    return c.post(f"{API}/approvals/{week_id}/reject", json=body, headers=headers)


def listing(c: TestClient, **params: Any) -> Any:
    return c.get(f"{API}/approvals", params=params)


def ids(response: Any) -> list[str]:
    return [item["week_id"] for item in response.json()["items"]]


# ---------------------------------------------------------------------------- access


def test_requires_a_session(client: TestClient) -> None:
    assert client.get(f"{API}/approvals").status_code == 401
    assert client.get(f"{API}/approvals/{uuid.uuid4()}").status_code == 401
    assert client.post(f"{API}/approvals/{uuid.uuid4()}/approve", json={}).status_code == 401


@pytest.mark.parametrize("method", ["list", "detail", "approve", "reject"])
def test_employees_have_no_access_to_any_approval_route(
    org: Org, world: World, method: str
) -> None:
    week_id = submit_week(org.emp, world)
    calls = {
        "list": lambda: org.emp.get(f"{API}/approvals"),
        "detail": lambda: org.emp.get(f"{API}/approvals/{week_id}"),
        "approve": lambda: org.emp.post(f"{API}/approvals/{week_id}/approve", json={}),
        "reject": lambda: org.emp.post(
            f"{API}/approvals/{week_id}/reject", json={"comment": REASON}
        ),
    }
    response = calls[method]()
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN"
    assert week_view(org.emp)["status"] == "SUBMITTED"  # untouched


def test_decisions_need_the_csrf_header(
    org: Org, world: World, make_client: Any, settings: Any
) -> None:
    week_id = submit_week(org.emp, world)
    bare = make_client(settings, headers={})
    bare.cookies.update(org.mgr.cookies)
    assert bare.post(f"{API}/approvals/{week_id}/approve", json={}).status_code == 403
    assert week_view(org.emp)["status"] == "SUBMITTED"


# ------------------------------------------------------------------------------ list


def test_a_manager_sees_only_their_own_reports_submissions(org: Org, world: World) -> None:
    mine = submit_week(org.emp, world)
    theirs = submit_week(org.out, world)
    assert ids(listing(org.mgr)) == [mine]
    assert ids(listing(org.mgr2)) == [theirs]
    assert set(ids(listing(org.adm))) == {mine, theirs}  # admin oversight


def test_drafts_never_appear_and_cannot_be_requested(org: Org, world: World) -> None:
    org.emp.post(f"{API}/time-entries", json=payload(world))  # a draft week
    assert listing(org.mgr).json()["items"] == []
    refused = listing(org.mgr, status="DRAFT")
    assert refused.status_code == 422
    assert "status" in refused.json()["error"]["field_errors"]


def test_list_items_carry_who_what_and_how_much(org: Org, world: World) -> None:
    org.emp.post(f"{API}/time-entries", json=payload(world, work_date=DAY, hours="8"))
    org.emp.post(f"{API}/time-entries", json=payload(world, work_date="2026-10-20", hours="6.25"))
    org.emp.post(f"{API}/timesheets/weeks/{DAY}/submit", json={})
    [item] = listing(org.mgr).json()["items"]
    assert item["employee"] == {
        "id": str(org.employee.id),
        "display_name": org.employee.display_name,
        "email": "emp@example.test",
    }
    assert (item["week_start_date"], item["week_end_date"]) == (DAY, "2026-10-25")
    assert (item["total_hours"], item["entry_count"], item["status"]) == ("14.25", 2, "SUBMITTED")
    assert item["submitted_at"] and item["reviewed_at"] is None and item["reviewer_name"] is None


def test_a_persons_own_week_is_never_in_their_own_queue(org: Org, world: World) -> None:
    own = submit_week(org.adm, world)  # the admin submits their own week
    mine = submit_week(org.emp, world)
    assert ids(listing(org.adm)) == [mine]
    assert own not in ids(listing(org.adm))


def test_status_and_week_filters(org: Org, world: World) -> None:
    first = submit_week(org.emp, world, DAY)
    second = submit_week(org.emp, world, "2026-10-26")
    assert approve(org.mgr, first).status_code == 200
    assert ids(listing(org.mgr)) == [second]  # default: still waiting
    assert ids(listing(org.mgr, status="APPROVED")) == [first]
    assert ids(listing(org.mgr, status="REJECTED")) == []
    assert ids(listing(org.mgr, week_start_date="2026-10-28")) == [second]  # any date in the week
    assert ids(listing(org.mgr, status="APPROVED", week_start_date="2026-10-26")) == []
    reviewed = listing(org.mgr, status="APPROVED").json()["items"][0]
    assert reviewed["reviewer_name"] == org.manager.display_name and reviewed["reviewed_at"]


def test_oldest_submission_first_and_paging_is_stable(org: Org, world: World) -> None:
    weeks = [
        f"2026-{m}-{d}"
        for m, d in (("09", "07"), ("09", "14"), ("09", "21"), ("09", "28"), ("10", "05"))
    ]
    submitted = [submit_week(org.emp, world, day) for day in weeks]
    first = listing(org.mgr, page_size=2, page=1).json()
    second = listing(org.mgr, page_size=2, page=2).json()
    third = listing(org.mgr, page_size=2, page=3).json()
    assert (first["total"], first["page"], first["page_size"]) == (5, 1, 2)
    paged = [i["week_id"] for page in (first, second, third) for i in page["items"]]
    assert paged == submitted  # submission order, no gaps, no repeats
    assert len(third["items"]) == 1
    assert listing(org.mgr, page_size=2, page=4).json()["items"] == []


@pytest.mark.parametrize(
    "params", [{"page": 0}, {"page_size": 0}, {"page_size": 101}, {"status": "NOPE"}]
)
def test_list_parameters_are_validated(org: Org, params: dict[str, Any]) -> None:
    assert listing(org.mgr, **params).status_code == 422


def test_sql_scope_and_python_policy_agree_for_every_actor(
    org: Org, world: World, db: Session
) -> None:
    for client in (org.emp, org.out, org.mgr, org.mgr2, org.adm):
        submit_week(client, world)
    everyone = {u.id: u for u in db.scalars(select(User))}
    weeks = db.scalars(select(TimesheetWeek)).all()
    for actor, client in (
        (org.manager, org.mgr),
        (org.other_manager, org.mgr2),
        (org.admin, org.adm),
    ):
        expected = {
            str(w.id)
            for w in weeks
            if review_policy.in_review_scope(
                actor_id=actor.id,
                actor_role=actor.role,
                employee_id=w.employee_id,
                employee_manager_id=everyone[w.employee_id].manager_id,
            )
        }
        assert set(ids(listing(client, page_size=100))) == expected, actor.email
    assert approvals_repo.VISIBLE_STATUSES  # drafts are excluded by construction


# ---------------------------------------------------------------------------- detail


def test_detail_has_everything_needed_to_decide(org: Org, world: World) -> None:
    week_id = submit_week(org.emp, world, hours="7.5")
    body = org.mgr.get(f"{API}/approvals/{week_id}").json()
    assert body["employee"]["email"] == "emp@example.test"
    assert body["week"]["id"] == week_id
    assert body["week"]["status"] == "SUBMITTED"
    assert body["week"]["summary"]["total_hours"] == "7.50"
    assert len(body["week"]["daily_totals"]) == 7
    assert body["week"]["entries"][0]["project"]["code"] == "P1"
    [event] = body["history"]
    assert (event["action"], event["comment"], event["actor"]["email"]) == (
        "SUBMITTED",
        "Please review",
        "emp@example.test",
    )


def test_detail_hides_weeks_a_manager_may_not_see_behind_a_plain_404(
    org: Org, world: World
) -> None:
    week_id = submit_week(org.emp, world)
    draft = org.emp.post(f"{API}/time-entries", json=payload(world, work_date="2026-11-02"))
    draft_week = week_view(org.emp, "2026-11-02")["id"]
    assert draft.status_code == 201
    outcomes = {
        "other manager": org.mgr2.get(f"{API}/approvals/{week_id}"),
        "draft week": org.mgr.get(f"{API}/approvals/{draft_week}"),
        "unknown id": org.mgr.get(f"{API}/approvals/{uuid.uuid4()}"),
    }
    assert {k: r.status_code for k, r in outcomes.items()} == dict.fromkeys(outcomes, 404)
    assert (
        len({r.text.split('"request_id"')[0] for r in outcomes.values()}) == 1
    )  # identical bodies
    assert org.adm.get(f"{API}/approvals/{week_id}").status_code == 200


def test_you_cannot_open_or_decide_your_own_week(org: Org, world: World) -> None:
    admin_week = submit_week(org.adm, world)
    manager_week = submit_week(org.mgr, world)
    for client, week_id in ((org.adm, admin_week), (org.mgr, manager_week)):
        assert client.get(f"{API}/approvals/{week_id}").status_code == 403
        assert approve(client, week_id).status_code == 403
        assert reject(client, week_id).status_code == 403
    assert week_view(org.adm)["status"] == "SUBMITTED"
    assert week_view(org.mgr)["status"] == "SUBMITTED"


def test_malformed_week_id_is_a_validation_error(org: Org) -> None:
    assert org.mgr.get(f"{API}/approvals/not-a-uuid").status_code == 422


# ------------------------------------------------------------------------- approving


def test_approving_records_who_when_and_notifies_the_employee(
    org: Org, world: World, db: Session
) -> None:
    week_id = submit_week(org.emp, world)
    response = approve(org.mgr, week_id, comment="  Thanks!  ")
    assert response.status_code == 200, response.text
    week = response.json()["week"]
    assert (week["status"], week["review_comment"], week["reviewed_by_name"]) == (
        "APPROVED",
        "Thanks!",
        org.manager.display_name,
    )
    assert week["reviewed_at"] and week["is_editable"] is False
    assert [h["action"] for h in response.json()["history"]] == ["SUBMITTED", "APPROVED"]

    db.expire_all()
    row = db.scalars(select(TimesheetWeek)).one()
    assert (row.status, row.reviewed_by) == (WeekStatus.APPROVED, org.manager.id)
    event = db.scalars(
        select(ApprovalEvent).where(ApprovalEvent.action == ApprovalAction.APPROVED)
    ).one()
    assert (event.actor_id, event.comment) == (org.manager.id, "Thanks!")

    outbox = db.scalars(
        select(NotificationOutbox).where(NotificationOutbox.event_type == "TIMESHEET_APPROVED")
    ).one()
    assert outbox.status is OutboxStatus.SENT
    assert outbox.payload == {
        "week_id": week_id,
        "employee_id": str(org.employee.id),
        "reviewer_id": str(org.manager.id),
        "week_start_date": DAY,
        "decision": "APPROVED",
    }
    assert "Thanks" not in str(outbox.payload)
    assert ("TIMESHEET_APPROVED", outbox.payload) in org.port.sent


def test_the_employee_sees_the_decision_and_the_week_stays_locked(org: Org, world: World) -> None:
    week_id = submit_week(org.emp, world)
    approve(org.mgr, week_id)
    view = week_view(org.emp)
    assert (view["status"], view["reviewed_by_name"], view["is_editable"]) == (
        "APPROVED",
        org.manager.display_name,
        False,
    )
    entry_id = view["entries"][0]["id"]
    for response in (
        org.emp.post(f"{API}/time-entries", json=payload(world, work_date="2026-10-21")),
        org.emp.patch(f"{API}/time-entries/{entry_id}", json={"hours": "1"}),
        org.emp.delete(f"{API}/time-entries/{entry_id}"),
        org.emp.post(f"{API}/timesheets/weeks/{DAY}/submit", json={}),
    ):
        assert response.status_code == 409


def test_an_admin_may_decide_and_is_recorded_as_the_actor(org: Org, world: World) -> None:
    week_id = submit_week(org.emp, world)
    response = approve(org.adm, week_id)
    assert response.status_code == 200
    assert response.json()["week"]["reviewed_by_name"] == org.admin.display_name
    assert response.json()["history"][-1]["actor"]["email"] == "adm@example.test"


# ------------------------------------------------------------------------- rejecting


def test_rejecting_needs_a_meaningful_reason(org: Org, world: World, db: Session) -> None:
    week_id = submit_week(org.emp, world)
    for comment in (None, "", "   ", "no", "  ok  "):
        response = reject(org.mgr, week_id, comment)
        assert response.status_code == 422, comment
        assert "comment" in response.json()["error"]["field_errors"]
    assert week_view(org.emp)["status"] == "SUBMITTED"
    assert count(db, ApprovalEvent) == 1  # only the submission
    assert reject(org.mgr, week_id, "x" * 1001).status_code == 422


def test_a_rejection_keeps_the_reason_visible_and_the_week_editable(
    org: Org, world: World, db: Session
) -> None:
    week_id = submit_week(org.emp, world)
    response = reject(org.mgr, week_id, f"  {REASON}  ")
    assert response.status_code == 200, response.text
    view = week_view(org.emp)
    assert (view["status"], view["review_comment"], view["is_editable"]) == (
        "REJECTED",
        REASON,
        True,
    )
    assert view["reviewed_by_name"] == org.manager.display_name
    assert (
        org.emp.post(f"{API}/time-entries", json=payload(world, work_date="2026-10-22")).status_code
        == 201
    )

    db.expire_all()
    outbox = db.scalars(
        select(NotificationOutbox).where(NotificationOutbox.event_type == "TIMESHEET_REJECTED")
    ).one()
    assert outbox.payload["decision"] == "REJECTED"
    assert "Tuesday" not in str(outbox.payload) and REASON not in str(outbox.payload)


def test_the_full_cycle_submit_reject_fix_resubmit_approve(org: Org, world: World) -> None:
    week_id = submit_week(org.emp, world)
    assert reject(org.mgr, week_id).status_code == 200
    assert listing(org.mgr).json()["items"] == []  # nothing waiting while it is with the employee
    assert ids(listing(org.mgr, status="REJECTED")) == [week_id]

    org.emp.post(f"{API}/time-entries", json=payload(world, work_date="2026-10-21", hours="2"))
    resubmitted = org.emp.post(f"{API}/timesheets/weeks/{DAY}/submit", json={"comment": "Fixed it"})
    assert resubmitted.status_code == 200
    assert (resubmitted.json()["review_comment"], resubmitted.json()["reviewed_at"]) == (None, None)

    assert ids(listing(org.mgr)) == [week_id]  # back in the queue
    final = approve(org.mgr, week_id, comment="Good now")
    assert final.status_code == 200
    history = final.json()["history"]
    assert [(h["action"], h["comment"]) for h in history] == [
        ("SUBMITTED", "Please review"),
        ("REJECTED", REASON),
        ("SUBMITTED", "Fixed it"),
        ("APPROVED", "Good now"),
    ]
    assert week_view(org.emp)["status"] == "APPROVED"


# ------------------------------------------------------------- authorization & state


def test_an_unassigned_manager_cannot_decide_and_nothing_changes(
    org: Org, world: World, db: Session
) -> None:
    week_id = submit_week(org.emp, world)
    for response in (approve(org.mgr2, week_id), reject(org.mgr2, week_id)):
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "NOT_FOUND"
    assert week_view(org.emp)["status"] == "SUBMITTED"
    assert count(db, ApprovalEvent) == 1
    assert count(db, IdempotencyKey) == 0


def test_only_a_submitted_week_can_be_decided(org: Org, world: World, db: Session) -> None:
    draft = org.emp.post(f"{API}/time-entries", json=payload(world, work_date="2026-11-02"))
    draft_week = week_view(org.emp, "2026-11-02")["id"]
    assert draft.status_code == 201
    assert approve(org.mgr, draft_week).status_code == 404  # drafts are invisible to managers

    approved = submit_week(org.emp, world, DAY)
    approve(org.mgr, approved)
    rejected = submit_week(org.emp, world, "2026-10-26")
    reject(org.mgr, rejected)
    events_before = count(db, ApprovalEvent)
    for week_id in (approved, rejected):
        for response in (approve(org.mgr, week_id), reject(org.mgr, week_id)):
            assert response.status_code == 409
            assert response.json()["error"]["code"] == "INVALID_TRANSITION"
    assert count(db, ApprovalEvent) == events_before


@pytest.mark.parametrize(
    "body", [{"status": "APPROVED"}, {"reviewer_id": "x"}, {"employee_id": "x"}]
)
def test_clients_cannot_name_the_reviewer_or_the_outcome(
    org: Org, world: World, body: dict[str, Any]
) -> None:
    week_id = submit_week(org.emp, world)
    assert org.mgr.post(f"{API}/approvals/{week_id}/approve", json=body).status_code == 422
    assert (
        org.mgr.post(
            f"{API}/approvals/{week_id}/reject", json={"comment": REASON, **body}
        ).status_code
        == 422
    )
    assert week_view(org.emp)["status"] == "SUBMITTED"


# --------------------------------------------------------- duplicates and concurrency


def test_retrying_with_the_same_key_returns_the_result_and_acts_once(
    org: Org, world: World, db: Session
) -> None:
    week_id = submit_week(org.emp, world)
    first = approve(org.mgr, week_id, key=KEY)
    retry = approve(org.mgr, week_id, key=KEY)
    assert (first.status_code, retry.status_code) == (200, 200)
    assert retry.json()["week"]["status"] == "APPROVED"
    assert (
        db.scalars(select(ApprovalEvent).where(ApprovalEvent.action == ApprovalAction.APPROVED))
        .all()
        .__len__()
        == 1
    )
    assert count(db, NotificationOutbox) == 2  # one for the submission, one for the decision


def test_a_key_cannot_be_reused_for_another_week_and_must_be_well_formed(
    org: Org, world: World
) -> None:
    one = submit_week(org.emp, world, DAY)
    two = submit_week(org.emp, world, "2026-10-26")
    assert approve(org.mgr, one, key=KEY).status_code == 200
    other = approve(org.mgr, two, key=KEY)
    assert other.status_code == 422
    assert "Idempotency-Key" in other.json()["error"]["field_errors"]
    assert approve(org.mgr, two, key="bad key!").status_code == 422
    assert week_view(org.emp, "2026-10-26")["status"] == "SUBMITTED"


def test_two_managers_racing_approve_and_reject_yields_one_decision(
    org: Org, world: World, db: Session, make_client: Any, settings: Any
) -> None:
    week_id = submit_week(org.emp, world)
    admin2 = make_client(settings, org.port)
    login(admin2, "adm@example.test")
    barrier = threading.Barrier(2)

    def run(args: tuple[TestClient, str]) -> int:
        client, verb = args
        barrier.wait()
        response = approve(client, week_id) if verb == "approve" else reject(client, week_id)
        return int(response.status_code)

    with ThreadPoolExecutor(2) as pool:
        statuses = sorted(pool.map(run, [(org.mgr, "approve"), (admin2, "reject")]))
    assert statuses == [200, 409]
    db.expire_all()
    decisions = db.scalars(
        select(ApprovalEvent).where(ApprovalEvent.action != ApprovalAction.SUBMITTED)
    ).all()
    assert len(decisions) == 1
    assert db.scalars(select(TimesheetWeek)).one().status.value == decisions[0].action.value


def test_many_simultaneous_approvals_produce_exactly_one(
    org: Org, world: World, db: Session, make_client: Any, settings: Any
) -> None:
    week_id = submit_week(org.emp, world)
    clients = []
    for _ in range(6):
        c = make_client(settings, org.port)
        c.cookies.update(org.mgr.cookies)
        clients.append(c)
    barrier = threading.Barrier(6)

    def run(c: TestClient) -> int:
        barrier.wait()
        return int(approve(c, week_id).status_code)

    with ThreadPoolExecutor(6) as pool:
        statuses = sorted(pool.map(run, clients))
    assert statuses == [200] + [409] * 5
    assert (
        len(
            db.scalars(
                select(ApprovalEvent).where(ApprovalEvent.action == ApprovalAction.APPROVED)
            ).all()
        )
        == 1
    )


# ------------------------------------------------------------- failure and notification


def test_a_failure_part_way_through_a_decision_changes_nothing(
    org: Org,
    world: World,
    db: Session,
    make_client: Any,
    settings: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    week_id = submit_week(org.emp, world)
    safe = make_client(settings, org.port, raise_server_exceptions=False)
    safe.cookies.update(org.mgr.cookies)

    def boom(*args: Any, **kwargs: Any) -> None:
        raise RuntimeError("simulated failure after the status was already changed")

    monkeypatch.setattr(notifications, "enqueue", boom)
    response = approve(safe, week_id, key=KEY)
    assert response.status_code == 500 and "simulated" not in response.text
    db.expire_all()
    row = db.scalars(select(TimesheetWeek)).one()
    assert (row.status, row.reviewed_by, row.reviewed_at) == (WeekStatus.SUBMITTED, None, None)
    assert count(db, ApprovalEvent) == 1 and count(db, IdempotencyKey) == 0
    monkeypatch.undo()
    assert approve(safe, week_id, key=KEY).status_code == 200  # the same retry now works


def test_a_failing_notification_provider_never_blocks_a_decision(
    org: Org, world: World, db: Session, make_client: Any, settings: Any
) -> None:
    week_id = submit_week(org.emp, world)
    mgr = make_client(settings, FailingPort())
    mgr.cookies.update(org.mgr.cookies)
    assert approve(mgr, week_id).status_code == 200
    row = db.scalars(
        select(NotificationOutbox).where(NotificationOutbox.event_type == "TIMESHEET_APPROVED")
    ).one()
    db.refresh(row)
    assert (row.status, row.attempt_count) == (OutboxStatus.PENDING, 1)
    assert week_view(org.emp)["status"] == "APPROVED"


# ----------------------------------------------------------------------------- audit


def test_history_lists_every_event_in_order_with_its_actor(org: Org, world: World) -> None:
    week_id = submit_week(org.emp, world)
    reject(org.mgr, week_id)
    history = org.mgr.get(f"{API}/approvals/{week_id}").json()["history"]
    assert [h["action"] for h in history] == ["SUBMITTED", "REJECTED"]
    assert [h["actor"]["email"] for h in history] == ["emp@example.test", "mgr@example.test"]
    assert history[0]["created_at"] <= history[1]["created_at"]


@pytest.mark.parametrize("table", ["approval_events", "time_entry_events"])
def test_audit_tables_are_append_only_in_the_database(
    org: Org, world: World, db: Session, table: str
) -> None:
    week_id = submit_week(org.emp, world)
    approve(org.mgr, week_id)
    assert db.execute(text(f"SELECT count(*) FROM {table}")).scalar_one() > 0
    for statement in (f"UPDATE {table} SET created_at = now()", f"DELETE FROM {table}"):
        with pytest.raises(DBAPIError, match="append-only"):
            db.execute(text(statement))
        db.rollback()
    # Appending is still fine, and the data is intact.
    assert db.execute(text(f"SELECT count(*) FROM {table}")).scalar_one() > 0


def test_a_week_with_decisions_cannot_be_deleted_either(
    org: Org, world: World, db: Session
) -> None:
    week_id = submit_week(org.emp, world)
    reject(org.mgr, week_id)
    with pytest.raises(DBAPIError):
        db.execute(text("DELETE FROM timesheet_weeks"))
    db.rollback()
    db.execute(update(User).where(User.id == org.employee.id).values(display_name="Renamed"))
    db.commit()  # normal updates elsewhere still work
