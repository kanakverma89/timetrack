"""Catalogue, hour policy, teams and the audit log: validation, effects and auditing."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Classification,
    ConfigAction,
    ConfigAuditEvent,
    ConfigEntity,
    PolicySetting,
    Role,
)
from app.tests.factories import make_earning, make_project, make_task, make_user
from app.tests.support import API, World, payload, week_view

A = f"{API}/admin"
DAY = "2026-10-21"


@pytest.fixture
def admin(db: Session, login_as: Any) -> TestClient:
    make_user(db, "admin@example.test", Role.ADMIN)
    return login_as("admin@example.test")  # type: ignore[no-any-return]


def audit(db: Session, **where: Any) -> list[ConfigAuditEvent]:
    db.expire_all()
    stmt = select(ConfigAuditEvent).order_by(ConfigAuditEvent.created_at, ConfigAuditEvent.id)
    for key, value in where.items():
        stmt = stmt.where(getattr(ConfigAuditEvent, key) == value)
    return list(db.scalars(stmt))


# ------------------------------------------------------------------------------ projects


def test_creating_a_project_normalises_the_code_and_audits_it(
    admin: TestClient, db: Session
) -> None:
    response = admin.post(
        f"{A}/projects", json={"code": "  prj-100 ", "name": "  New thing ", "description": "Why"}
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert (body["code"], body["name"], body["is_active"], body["task_count"]) == (
        "PRJ-100",
        "New thing",
        True,
        0,
    )
    [event] = audit(db, entity_id=uuid.UUID(body["id"]))
    assert (event.entity_type, event.action) == (ConfigEntity.PROJECT, ConfigAction.CREATED)
    assert event.details["label"] == "PRJ-100 New thing"


@pytest.mark.parametrize("code", ["", " ", "-LEADING", "has space", "bad/slash", "x" * 51, "über"])
def test_project_codes_are_validated(admin: TestClient, code: str) -> None:
    response = admin.post(f"{A}/projects", json={"code": code, "name": "N"})
    assert response.status_code == 422
    assert "code" in response.json()["error"]["field_errors"]


def test_duplicate_codes_are_a_conflict_whatever_the_case(admin: TestClient, db: Session) -> None:
    make_project(db, "PRJ-1")
    duplicate = admin.post(f"{A}/projects", json={"code": "prj-1", "name": "Again"})
    assert duplicate.status_code == 409
    assert "code" in duplicate.json()["error"]["field_errors"]


def test_listing_includes_inactive_and_pages_and_searches(admin: TestClient, db: Session) -> None:
    for n in range(5):
        make_project(db, f"P-{n}", active=n != 4, name=f"Alpha {n}" if n < 3 else f"Beta {n}")
    everything = admin.get(f"{A}/projects", params={"page_size": 100}).json()
    assert everything["total"] == 5 and [i["code"] for i in everything["items"]] == [
        f"P-{n}" for n in range(5)
    ]
    assert admin.get(f"{A}/projects", params={"active": "false"}).json()["total"] == 1
    assert admin.get(f"{A}/projects", params={"search": "alpha"}).json()["total"] == 3
    assert admin.get(f"{A}/projects", params={"search": "%"}).json()["total"] == 0
    assert (
        admin.get(f"{A}/projects", params={"page_size": 2, "page": 3}).json()["items"][0]["code"]
        == "P-4"
    )


def test_deactivating_a_project_stops_new_entries_but_keeps_history(
    admin: TestClient, authed: TestClient, world: World, db: Session
) -> None:
    created = authed.post(f"{API}/time-entries", json=payload(world, work_date=DAY))
    assert created.status_code == 201
    before = week_view(authed)

    off = admin.patch(f"{A}/projects/{world.project.id}", json={"is_active": False})
    assert off.status_code == 200 and off.json()["is_active"] is False
    # existing history is untouched...
    assert week_view(authed)["entries"] == before["entries"]
    # ...the project vanishes from pickers and cannot take new time...
    assert world.project.code not in [
        p["code"] for p in authed.get(f"{API}/projects").json()["items"]
    ]
    refused = authed.post(f"{API}/time-entries", json=payload(world, work_date="2026-10-22"))
    assert refused.status_code == 422 and "project_id" in refused.json()["error"]["field_errors"]
    # ...but an old entry can still be edited without being blocked by the retirement.
    entry_id = before["entries"][0]["id"]
    assert (
        authed.patch(f"{API}/time-entries/{entry_id}", json={"description": "Tidy"}).status_code
        == 200
    )

    on = admin.patch(f"{A}/projects/{world.project.id}", json={"is_active": True})
    assert on.status_code == 200
    assert (
        authed.post(f"{API}/time-entries", json=payload(world, work_date="2026-10-22")).status_code
        == 201
    )
    actions = [e.action for e in audit(db, entity_id=world.project.id)]
    assert actions == [ConfigAction.DEACTIVATED, ConfigAction.REACTIVATED]


def test_project_update_validates_and_records_changes(admin: TestClient, db: Session) -> None:
    project = make_project(db, "PRJ-7", name="Old")
    assert admin.patch(f"{A}/projects/{project.id}", json={}).status_code == 422
    assert (
        admin.patch(f"{A}/projects/{project.id}", json={"code": "NEW"}).status_code == 422
    )  # immutable
    assert admin.patch(f"{A}/projects/{project.id}", json={"name": None}).status_code == 422
    ok = admin.patch(f"{A}/projects/{project.id}", json={"name": "New", "description": "d"})
    assert ok.status_code == 200
    [event] = audit(db, entity_id=project.id)
    assert event.details["changes"] == {
        "name": {"from": "Old", "to": "New"},
        "description": {"from": None, "to": "d"},
    }
    assert admin.patch(f"{A}/projects/{uuid.uuid4()}", json={"name": "x"}).status_code == 404


# -------------------------------------------------------------------------------- tasks


def test_tasks_are_unique_per_project_and_deactivation_hides_them(
    admin: TestClient, authed: TestClient, world: World, db: Session
) -> None:
    other = make_project(db, "OTHER")
    assert (
        admin.post(
            f"{A}/projects/{other.id}/tasks",
            json={"code": "t1", "name": "Same code, other project"},
        ).status_code
        == 201
    )
    dup = admin.post(f"{A}/projects/{world.project.id}/tasks", json={"code": "T1", "name": "Dup"})
    assert dup.status_code == 409
    assert (
        admin.post(
            f"{A}/projects/{uuid.uuid4()}/tasks", json={"code": "X", "name": "x"}
        ).status_code
        == 404
    )

    tasks = admin.get(f"{A}/projects/{world.project.id}/tasks").json()["items"]
    assert [t["code"] for t in tasks] == ["T1"]
    assert admin.patch(f"{A}/tasks/{world.task.id}", json={"is_active": False}).status_code == 200
    assert authed.get(f"{API}/projects/{world.project.id}/tasks").json()["items"] == []
    assert (
        admin.get(f"{A}/projects/{world.project.id}/tasks").json()["items"][0]["is_active"] is False
    )
    refused = authed.post(f"{API}/time-entries", json=payload(world, work_date=DAY))
    assert refused.status_code == 422 and "task_id" in refused.json()["error"]["field_errors"]
    assert admin.patch(f"{A}/tasks/{world.task.id}", json={"code": "Z"}).status_code == 422
    assert [e.action for e in audit(db, entity_id=world.task.id)] == [ConfigAction.DEACTIVATED]


def test_a_new_task_becomes_usable_straight_away(
    admin: TestClient, authed: TestClient, world: World
) -> None:
    created = admin.post(
        f"{A}/projects/{world.plain_project.id}/tasks", json={"code": "n1", "name": "Fresh"}
    )
    assert created.status_code == 201
    entry = payload(
        world, work_date=DAY, project_id=str(world.plain_project.id), task_id=created.json()["id"]
    )
    assert authed.post(f"{API}/time-entries", json=entry).status_code == 201


# --------------------------------------------------------------------------- earning codes


def test_earning_code_lifecycle_and_classification_lock(
    admin: TestClient, authed: TestClient, world: World, db: Session
) -> None:
    fresh = admin.post(
        f"{A}/earning-codes",
        json={"code": "bonus", "name": "Bonus", "classification": "NON_CAPPED"},
    )
    assert (
        fresh.status_code == 201
        and fresh.json()["code"] == "BONUS"
        and fresh.json()["entry_count"] == 0
    )
    code_id = fresh.json()["id"]
    assert (
        admin.post(
            f"{A}/earning-codes",
            json={"code": "BONUS", "name": "Again", "classification": "CAPPED"},
        ).status_code
        == 409
    )

    # Unused: the classification may change freely.
    assert (
        admin.patch(f"{A}/earning-codes/{code_id}", json={"classification": "CAPPED"}).status_code
        == 200
    )
    # Used by an entry: it is locked, because past totals would silently change.
    authed.post(f"{API}/time-entries", json=payload(world, work_date=DAY, earning_code_id=code_id))
    locked = admin.patch(f"{A}/earning-codes/{code_id}", json={"classification": "NON_CAPPED"})
    assert locked.status_code == 409 and locked.json()["error"]["code"] == "CLASSIFICATION_LOCKED"
    assert week_view(authed)["summary"]["capped_hours"] == "8.00"  # unchanged
    # Renaming and deactivating a used code are fine.
    assert (
        admin.patch(f"{A}/earning-codes/{code_id}", json={"name": "Bonus pay"}).status_code == 200
    )
    assert admin.patch(f"{A}/earning-codes/{code_id}", json={"is_active": False}).status_code == 200
    assert (
        next(c for c in admin.get(f"{A}/earning-codes").json()["items"] if c["id"] == code_id)[
            "entry_count"
        ]
        == 1
    )
    assert "BONUS" not in [c["code"] for c in authed.get(f"{API}/earning-codes").json()["items"]]
    refused = authed.post(
        f"{API}/time-entries", json=payload(world, work_date="2026-10-22", earning_code_id=code_id)
    )
    assert refused.status_code == 422
    kinds = [e.action for e in audit(db, entity_id=uuid.UUID(code_id))]
    assert kinds == [
        ConfigAction.CREATED,
        ConfigAction.UPDATED,
        ConfigAction.UPDATED,
        ConfigAction.DEACTIVATED,
    ]


# ------------------------------------------------------------------------------- policy


def test_policy_starts_from_the_environment_and_is_overridden_in_the_database(
    admin: TestClient, db: Session
) -> None:
    first = admin.get(f"{A}/policy").json()
    assert first["source"] == "environment" and first["updated_by_name"] is None
    assert first["max_hours_per_entry"] == "24.00" and first["max_hours_per_day"] is None

    saved = admin.put(
        f"{A}/policy",
        json={
            "max_hours_per_entry": "10",
            "max_hours_per_day": "12",
            "max_hours_per_week": "50",
            "description_max_length": 100,
        },
    )
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["source"] == "database" and body["updated_by_name"] == "Admin"
    assert (body["max_hours_per_entry"], body["max_hours_per_day"], body["max_hours_per_week"]) == (
        "10.00",
        "12.00",
        "50.00",
    )
    assert body["environment_defaults"]["max_hours_per_entry"] == "24.00"
    assert db.get(PolicySetting, 1) is not None
    [event] = audit(db, entity_type=ConfigEntity.POLICY)
    assert event.details["changes"]["max_hours_per_entry"] == {"from": "24.00", "to": "10.00"}


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"max_hours_per_entry": "0", "description_max_length": 10}, "max_hours_per_entry"),
        ({"max_hours_per_entry": "25", "description_max_length": 10}, "max_hours_per_entry"),
        ({"max_hours_per_entry": "8.555", "description_max_length": 10}, "max_hours_per_entry"),
        (
            {"max_hours_per_entry": "8", "max_hours_per_day": "169", "description_max_length": 10},
            "max_hours_per_day",
        ),
        (
            {"max_hours_per_entry": "8", "max_hours_per_week": "169", "description_max_length": 10},
            "max_hours_per_week",
        ),
        ({"max_hours_per_entry": "8", "description_max_length": 0}, "description_max_length"),
        ({"max_hours_per_entry": "8", "description_max_length": 257}, "description_max_length"),
        (
            {
                "max_hours_per_entry": "8",
                "max_hours_per_day": "10",
                "max_hours_per_week": "9",
                "description_max_length": 10,
            },
            "max_hours_per_week",
        ),
        (
            {"max_hours_per_entry": "11", "max_hours_per_day": "10", "description_max_length": 10},
            "max_hours_per_entry",
        ),
        ({"max_hours_per_entry": "8", "description_max_length": 10, "nope": 1}, "nope"),
    ],
)
def test_invalid_policies_are_rejected_and_change_nothing(
    admin: TestClient, db: Session, body: dict[str, Any], field: str
) -> None:
    response = admin.put(f"{A}/policy", json=body)
    assert response.status_code == 422
    assert field in response.json()["error"]["field_errors"]
    assert db.get(PolicySetting, 1) is None
    assert audit(db, entity_type=ConfigEntity.POLICY) == []


def test_a_policy_change_takes_effect_immediately_for_entries_meta_and_submission(
    admin: TestClient, authed: TestClient, world: World
) -> None:
    assert authed.get(f"{API}/meta").json()["max_hours_per_entry"] == "24.00"
    assert authed.post(f"{API}/time-entries", json=payload(world, hours="9")).status_code == 201

    admin.put(
        f"{A}/policy",
        json={
            "max_hours_per_entry": "6",
            "max_hours_per_day": "10",
            "max_hours_per_week": "12",
            "description_max_length": 20,
        },
    )
    meta = authed.get(f"{API}/meta").json()
    assert (meta["max_hours_per_entry"], meta["description_max_length"]) == ("6.00", 20)
    too_long = authed.post(
        f"{API}/time-entries", json=payload(world, work_date="2026-10-22", hours="7")
    )
    assert too_long.status_code == 422 and "6" in too_long.json()["error"]["field_errors"]["hours"]
    wordy = authed.post(
        f"{API}/time-entries",
        json=payload(world, work_date="2026-10-22", hours="1", description="x" * 21),
    )
    assert wordy.status_code == 422 and "description" in wordy.json()["error"]["field_errors"]
    assert (
        authed.post(
            f"{API}/time-entries", json=payload(world, work_date="2026-10-22", hours="5")
        ).status_code
        == 201
    )

    # The earlier 9 h entry now breaks the stricter rules, and submission says so.
    submit = authed.post(f"{API}/timesheets/weeks/{DAY}/submit", json={})
    assert submit.status_code == 422
    errors = submit.json()["error"]["field_errors"]
    assert any(k.startswith("entries.") and k.endswith(".hours") for k in errors)
    assert "week" in errors  # 14 h in the week against a 12 h limit
    assert admin.get(f"{A}/policy").json()["source"] == "database"


def test_resetting_the_policy_returns_to_the_environment_defaults(
    admin: TestClient, authed: TestClient, db: Session
) -> None:
    admin.put(f"{A}/policy", json={"max_hours_per_entry": "6", "description_max_length": 20})
    assert authed.get(f"{API}/meta").json()["max_hours_per_entry"] == "6.00"
    reset = admin.delete(f"{A}/policy")
    assert reset.status_code == 200 and reset.json()["source"] == "environment"
    assert authed.get(f"{API}/meta").json()["max_hours_per_entry"] == "24.00"
    assert db.get(PolicySetting, 1) is None
    assert [e.action for e in audit(db, entity_type=ConfigEntity.POLICY)] == [
        ConfigAction.UPDATED,
        ConfigAction.DELETED,
    ]
    assert admin.delete(f"{A}/policy").status_code == 200  # idempotent
    assert len(audit(db, entity_type=ConfigEntity.POLICY)) == 2  # and nothing new to audit


# -------------------------------------------------------------------------------- teams


def test_team_lifecycle_membership_and_audit(admin: TestClient, db: Session) -> None:
    a, b, c = (make_user(db, f"{n}@example.test") for n in "abc")
    team = admin.post(f"{A}/teams", json={"name": "  Platform  "})
    assert team.status_code == 201 and team.json()["name"] == "Platform"
    team_id = team.json()["id"]
    assert admin.post(f"{A}/teams", json={"name": "PLATFORM"}).status_code == 409

    members = admin.put(f"{A}/teams/{team_id}/members", json={"user_ids": [str(a.id), str(b.id)]})
    assert members.status_code == 200 and members.json()["member_count"] == 2
    swapped = admin.put(f"{A}/teams/{team_id}/members", json={"user_ids": [str(b.id), str(c.id)]})
    assert [m["email"] for m in swapped.json()["members"]] == ["b@example.test", "c@example.test"]
    [_, change] = [
        e
        for e in audit(db, entity_id=uuid.UUID(team_id))
        if e.action is ConfigAction.MEMBERS_CHANGED
    ]
    # Stored as ids, never emails (the trail is append-only and must survive anonymisation)...
    assert change.details["changes"]["added"]["to"] == [str(c.id)]
    assert change.details["changes"]["removed"]["from"] == [str(a.id)]
    assert "@example.test" not in str(change.details)
    # ...and shown with the people's current names.
    shown = admin.get(f"{A}/audit", params={"entity_id": team_id}).json()["items"]
    members_event = next(i for i in shown if i["action"] == "MEMBERS_CHANGED")
    assert members_event["details"]["changes"]["added"]["to"] == [c.display_name]
    assert members_event["details"]["changes"]["removed"]["from"] == [a.display_name]
    # A person who is later anonymised reads as "Former employee" in that same history.
    c.is_active = False
    db.commit()
    from app.maintenance import anonymise_user

    anonymise_user(db, c.id)
    after = admin.get(f"{A}/audit", params={"entity_id": team_id}).json()["items"]
    event = next(i for i in after if i["action"] == "MEMBERS_CHANGED")
    assert event["details"]["changes"]["added"]["to"] == ["Former employee"]
    assert "c@example.test" not in str(after)

    assert admin.patch(f"{A}/teams/{team_id}", json={"name": "Core"}).json()["name"] == "Core"
    assert admin.get(f"{A}/teams").json()["items"][0]["member_count"] == 2
    assert admin.delete(f"{A}/teams/{team_id}").status_code == 204
    assert admin.get(f"{A}/teams/{team_id}").status_code == 404
    assert audit(db, entity_id=uuid.UUID(team_id))[-1].action is ConfigAction.DELETED


def test_team_members_must_be_real_active_users(admin: TestClient, db: Session) -> None:
    gone = make_user(db, "gone@example.test", active=False)
    team = admin.post(f"{A}/teams", json={"name": "T"}).json()["id"]
    for bad in ([str(uuid.uuid4())], [str(gone.id)]):
        response = admin.put(f"{A}/teams/{team}/members", json={"user_ids": bad})
        assert (
            response.status_code == 422 and "user_ids" in response.json()["error"]["field_errors"]
        )
    assert admin.get(f"{A}/teams/{team}").json()["member_count"] == 0


def test_team_membership_grants_no_review_rights(
    admin: TestClient, db: Session, login_as: Any, world: World
) -> None:
    """Sharing a team with an employee must not let a manager see or decide their weeks."""
    outsider = make_user(db, "outsider@example.test", Role.MANAGER)
    team = admin.post(f"{A}/teams", json={"name": "Shared"}).json()["id"]
    admin.put(
        f"{A}/teams/{team}/members", json={"user_ids": [str(world.user.id), str(outsider.id)]}
    )
    emp = login_as("emp@example.test")
    emp.post(f"{API}/time-entries", json=payload(world))
    week_id = emp.post(f"{API}/timesheets/weeks/{DAY}/submit", json={}).json()["id"]
    mgr = login_as("outsider@example.test")
    assert mgr.get(f"{API}/approvals").json()["total"] == 0
    assert mgr.get(f"{API}/approvals/{week_id}").status_code == 404
    assert mgr.post(f"{API}/approvals/{week_id}/approve", json={}).status_code == 404


# -------------------------------------------------------------------------------- audit


def test_the_audit_log_is_paged_filtered_newest_first_and_names_the_actor(
    admin: TestClient, db: Session
) -> None:
    admin.post(f"{A}/projects", json={"code": "A1", "name": "One"})
    admin.post(f"{A}/teams", json={"name": "Two"})
    project = admin.post(f"{A}/projects", json={"code": "A3", "name": "Three"}).json()
    admin.patch(f"{A}/projects/{project['id']}", json={"name": "Three!"})

    everything = admin.get(f"{A}/audit", params={"page_size": 100}).json()
    assert everything["total"] == 4
    stamps = [i["created_at"] for i in everything["items"]]
    assert stamps == sorted(stamps, reverse=True)
    assert all(i["actor"]["email"] == "admin@example.test" for i in everything["items"])
    assert admin.get(f"{A}/audit", params={"entity_type": "PROJECT"}).json()["total"] == 3
    assert admin.get(f"{A}/audit", params={"entity_type": "TEAM"}).json()["total"] == 1
    one = admin.get(f"{A}/audit", params={"entity_id": project["id"]}).json()
    assert [i["action"] for i in one["items"]] == ["UPDATED", "CREATED"]
    assert (
        admin.get(f"{A}/audit", params={"page_size": 3, "page": 2}).json()["items"].__len__() == 1
    )
    assert admin.get(f"{A}/audit", params={"entity_type": "NOPE"}).status_code == 422


def test_failed_changes_leave_no_audit_trail(admin: TestClient, db: Session) -> None:
    make_project(db, "DUP")
    admin.post(f"{A}/projects", json={"code": "DUP", "name": "x"})  # 409
    admin.post(f"{A}/projects", json={"code": "bad code", "name": "x"})  # 422
    admin.put(f"{A}/policy", json={"max_hours_per_entry": "0", "description_max_length": 10})  # 422
    assert audit(db) == []
    make_task(db, make_project(db, "Q"), "T")
    make_earning(db, "C", Classification.CAPPED)
    assert audit(db) == []  # fixtures write directly; only API changes are audited
