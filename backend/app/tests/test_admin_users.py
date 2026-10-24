"""User administration: create, update, deactivate, reset; safety rules; audit; access."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models import AuthSession, ConfigAction, ConfigAuditEvent, ConfigEntity, Role, User
from app.tests.factories import PASSWORD, make_user
from app.tests.support import API

A = f"{API}/admin"


@pytest.fixture
def admin(db: Session, login_as: Any) -> TestClient:
    make_user(db, "admin@example.test", Role.ADMIN)
    return login_as("admin@example.test")  # type: ignore[no-any-return]


def new_user(client: TestClient, email: str = "new@example.test", **overrides: Any) -> Any:
    body = {"email": email, "display_name": "New Person", "role": "EMPLOYEE", "manager_id": None}
    body.update(overrides)
    return client.post(f"{A}/users", json=body)


def audit_rows(db: Session, **where: Any) -> list[ConfigAuditEvent]:
    db.expire_all()
    stmt = select(ConfigAuditEvent).order_by(ConfigAuditEvent.created_at, ConfigAuditEvent.id)
    for key, value in where.items():
        stmt = stmt.where(getattr(ConfigAuditEvent, key) == value)
    return list(db.scalars(stmt))


# --------------------------------------------------------------------------- access

ADMIN_ROUTES = [
    ("GET", "/admin/users"),
    ("POST", "/admin/users"),
    ("GET", f"/admin/users/{uuid.uuid4()}"),
    ("PATCH", f"/admin/users/{uuid.uuid4()}"),
    ("POST", f"/admin/users/{uuid.uuid4()}/reset-password"),
    ("GET", "/admin/teams"),
    ("POST", "/admin/teams"),
    ("PUT", f"/admin/teams/{uuid.uuid4()}/members"),
    ("DELETE", f"/admin/teams/{uuid.uuid4()}"),
    ("GET", "/admin/projects"),
    ("POST", "/admin/projects"),
    ("PATCH", f"/admin/projects/{uuid.uuid4()}"),
    ("POST", f"/admin/projects/{uuid.uuid4()}/tasks"),
    ("PATCH", f"/admin/tasks/{uuid.uuid4()}"),
    ("GET", "/admin/earning-codes"),
    ("POST", "/admin/earning-codes"),
    ("PATCH", f"/admin/earning-codes/{uuid.uuid4()}"),
    ("GET", "/admin/policy"),
    ("PUT", "/admin/policy"),
    ("DELETE", "/admin/policy"),
    ("GET", "/admin/audit"),
]


@pytest.mark.parametrize(("method", "path"), ADMIN_ROUTES)
@pytest.mark.parametrize("role", [Role.EMPLOYEE, Role.MANAGER])
def test_only_administrators_can_use_admin_routes(
    db: Session, login_as: Any, client: TestClient, method: str, path: str, role: Role
) -> None:
    make_user(db, "someone@example.test", role)
    who = login_as("someone@example.test")
    response = who.request(method, f"{API}{path}", json={})
    assert response.status_code == 403, (method, path, response.text)
    assert response.json()["error"]["code"] == "FORBIDDEN"
    # ...and a visitor with no session gets 401, not a hint about the route.
    assert (
        client.request(
            method, f"{API}{path}", json={}, headers={"X-Requested-With": "timetrack"}
        ).status_code
        == 401
    )


# ---------------------------------------------------------------------------- create


def test_creating_a_user_returns_a_one_time_password_that_must_be_changed(
    admin: TestClient, db: Session, login_as: Any, make_client: Any, settings: Any
) -> None:
    created = new_user(admin)
    assert created.status_code == 201, created.text
    body = created.json()
    temporary = body["temporary_password"]
    assert len(temporary) >= 16
    assert (
        body["user"]["email"] == "new@example.test" and body["user"]["must_change_password"] is True
    )

    db.expire_all()
    stored = db.scalars(select(User).where(User.email == "new@example.test")).one()
    assert stored.password_hash and temporary not in stored.password_hash  # only a hash is kept
    assert stored.password_hash.startswith("$argon2id$")

    # They can sign in, but nothing works until the password is changed.
    newcomer = make_client(settings)
    assert (
        newcomer.post(
            f"{API}/auth/login", json={"email": "new@example.test", "password": temporary}
        ).status_code
        == 200
    )
    me = newcomer.get(f"{API}/auth/me")
    assert me.status_code == 200 and me.json()["must_change_password"] is True
    blocked = newcomer.get(f"{API}/timesheets/weeks/2026-10-19")
    assert blocked.status_code == 403
    assert blocked.json()["error"]["code"] == "PASSWORD_CHANGE_REQUIRED"
    assert newcomer.get(f"{API}/projects").status_code == 403

    changed = newcomer.post(
        f"{API}/auth/change-password",
        json={"current_password": temporary, "new_password": "a-brand-new-long-passphrase"},
    )
    assert changed.status_code == 204
    assert newcomer.get(f"{API}/timesheets/weeks/2026-10-19").status_code == 200
    assert newcomer.get(f"{API}/auth/me").json()["must_change_password"] is False


def test_the_temporary_password_is_never_audited_or_listed(admin: TestClient, db: Session) -> None:
    temporary = new_user(admin).json()["temporary_password"]
    rows = audit_rows(db)
    assert temporary not in str([r.details for r in rows])
    assert "password" not in str([r.details for r in rows]).lower().replace("password_reset", "")
    listing = admin.get(f"{A}/users").text
    assert temporary not in listing and "password_hash" not in listing and "argon2" not in listing


def test_email_is_normalised_and_must_be_unique_ignoring_case(admin: TestClient) -> None:
    assert (
        new_user(admin, "  Mixed.Case@Example.TEST ").json()["user"]["email"]
        == "mixed.case@example.test"
    )
    duplicate = new_user(admin, "MIXED.CASE@example.test")
    assert duplicate.status_code == 409
    assert "email" in duplicate.json()["error"]["field_errors"]


@pytest.mark.parametrize(
    "email", ["", "no-at-sign", "a@b", "two@@example.test", "spa ce@example.test"]
)
def test_invalid_emails_are_rejected(admin: TestClient, email: str) -> None:
    response = new_user(admin, email)
    assert response.status_code == 422
    assert "email" in response.json()["error"]["field_errors"]


def test_a_manager_must_be_an_active_manager_or_admin(admin: TestClient, db: Session) -> None:
    employee = make_user(db, "e@example.test")
    retired = make_user(db, "retired@example.test", Role.MANAGER, active=False)
    good = make_user(db, "boss@example.test", Role.MANAGER)
    for bad in (employee.id, retired.id, uuid.uuid4()):
        response = new_user(admin, "x@example.test", manager_id=str(bad))
        assert response.status_code == 422, bad
        assert "manager_id" in response.json()["error"]["field_errors"]
    ok = new_user(admin, "x@example.test", manager_id=str(good.id))
    assert ok.status_code == 201 and ok.json()["user"]["manager"]["email"] == "boss@example.test"


def test_create_refuses_unknown_fields_and_bad_roles(admin: TestClient) -> None:
    assert new_user(admin, role="SUPERUSER").status_code == 422
    assert new_user(admin, must_change_password=False).status_code == 422
    assert new_user(admin, password="chosen-by-client").status_code == 422  # clients never pick it


# ----------------------------------------------------------------------------- list


def test_list_pages_filters_and_searches_literally(admin: TestClient, db: Session) -> None:
    boss = make_user(db, "boss@example.test", Role.MANAGER)
    for n in range(5):
        u = make_user(db, f"worker{n}@example.test")
        u.manager_id = boss.id
    make_user(db, "100%.real@example.test")
    make_user(db, "gone@example.test", active=False)
    db.commit()

    everyone = admin.get(f"{A}/users", params={"page_size": 100}).json()
    assert everyone["total"] == 9  # admin + boss + 5 workers + 100% + gone
    first = admin.get(f"{A}/users", params={"page_size": 4, "page": 1}).json()
    third = admin.get(f"{A}/users", params={"page_size": 4, "page": 3}).json()
    assert len(first["items"]) == 4 and len(third["items"]) == 1 and first["total"] == 9
    names = [i["display_name"].lower() for i in everyone["items"]]
    assert names == sorted(names)

    assert admin.get(f"{A}/users", params={"search": "WORKER3"}).json()["total"] == 1
    assert admin.get(f"{A}/users", params={"search": "%"}).json()["total"] == 1  # literal percent
    assert admin.get(f"{A}/users", params={"role": "MANAGER"}).json()["total"] == 1
    assert admin.get(f"{A}/users", params={"active": "false"}).json()["total"] == 1
    candidates = admin.get(f"{A}/users", params={"managers_only": "true"}).json()["items"]
    assert {c["email"] for c in candidates} == {"admin@example.test", "boss@example.test"}
    assert (
        next(i for i in everyone["items"] if i["email"] == "boss@example.test")["report_count"] == 5
    )
    assert admin.get(f"{A}/users", params={"page_size": 101}).status_code == 422


# ---------------------------------------------------------------------------- update


def test_updating_fields_is_audited_with_before_and_after(admin: TestClient, db: Session) -> None:
    target = make_user(db, "t@example.test")
    boss = make_user(db, "boss@example.test", Role.MANAGER)
    response = admin.patch(
        f"{A}/users/{target.id}",
        json={"display_name": "  Renamed  ", "manager_id": str(boss.id)},
    )
    assert response.status_code == 200, response.text
    assert response.json()["display_name"] == "Renamed"
    assert response.json()["manager"]["email"] == "boss@example.test"
    [event] = audit_rows(db, entity_id=target.id)
    assert (event.action, event.entity_type) == (ConfigAction.UPDATED, ConfigEntity.USER)
    assert event.details["label"] == "t@example.test"
    assert event.details["changes"]["display_name"] == {"from": "T", "to": "Renamed"}
    assert event.details["changes"]["manager_id"] == {"from": None, "to": str(boss.id)}


def test_a_no_op_update_writes_no_audit_row(admin: TestClient, db: Session) -> None:
    target = make_user(db, "t@example.test")
    assert admin.patch(f"{A}/users/{target.id}", json={"role": "EMPLOYEE"}).status_code == 200
    assert audit_rows(db, entity_id=target.id) == []


@pytest.mark.parametrize(
    "body", [{}, {"role": None}, {"is_active": None}, {"email": "x@y.test"}, {"password": "x"}]
)
def test_update_validates_its_body(admin: TestClient, db: Session, body: dict[str, Any]) -> None:
    target = make_user(db, "t@example.test")
    assert admin.patch(f"{A}/users/{target.id}", json=body).status_code == 422


def test_unknown_user_is_404(admin: TestClient) -> None:
    assert admin.patch(f"{A}/users/{uuid.uuid4()}", json={"display_name": "x"}).status_code == 404
    assert admin.get(f"{A}/users/{uuid.uuid4()}").status_code == 404
    assert admin.post(f"{A}/users/{uuid.uuid4()}/reset-password").status_code == 404


def test_management_loops_and_self_management_are_refused(admin: TestClient, db: Session) -> None:
    a = make_user(db, "a@example.test", Role.MANAGER)
    b = make_user(db, "b@example.test", Role.MANAGER)
    c = make_user(db, "c@example.test", Role.MANAGER)
    assert admin.patch(f"{A}/users/{b.id}", json={"manager_id": str(a.id)}).status_code == 200
    assert admin.patch(f"{A}/users/{c.id}", json={"manager_id": str(b.id)}).status_code == 200
    loop = admin.patch(f"{A}/users/{a.id}", json={"manager_id": str(c.id)})  # a -> c -> b -> a
    assert loop.status_code == 422 and "loop" in loop.json()["error"]["field_errors"]["manager_id"]
    own = admin.patch(f"{A}/users/{a.id}", json={"manager_id": str(a.id)})
    assert own.status_code == 422
    db.expire_all()
    assert db.get(User, a.id).manager_id is None  # type: ignore[union-attr]


def test_an_admin_cannot_demote_or_deactivate_themselves(admin: TestClient, db: Session) -> None:
    make_user(db, "other-admin@example.test", Role.ADMIN)
    me = db.scalars(select(User).where(User.email == "admin@example.test")).one()
    demote = admin.patch(f"{A}/users/{me.id}", json={"role": "MANAGER"})
    off = admin.patch(f"{A}/users/{me.id}", json={"is_active": False})
    assert demote.status_code == off.status_code == 422
    assert "role" in demote.json()["error"]["field_errors"]
    assert "is_active" in off.json()["error"]["field_errors"]
    assert (
        admin.patch(f"{A}/users/{me.id}", json={"display_name": "Me, renamed"}).status_code == 200
    )


def test_an_admin_can_remove_another_admin_while_one_remains(
    admin: TestClient, db: Session
) -> None:
    second = make_user(db, "second@example.test", Role.ADMIN)
    assert admin.patch(f"{A}/users/{second.id}", json={"role": "MANAGER"}).status_code == 200
    third = make_user(db, "third@example.test", Role.ADMIN)
    assert admin.patch(f"{A}/users/{third.id}", json={"is_active": False}).status_code == 200


def test_two_admins_cannot_remove_each_other_at_the_same_moment(db: Session, login_as: Any) -> None:
    """Unlocked, both see "another admin remains" and the system is left with no administrator."""
    import threading
    from concurrent.futures import ThreadPoolExecutor

    one = make_user(db, "one@example.test", Role.ADMIN)
    two = make_user(db, "two@example.test", Role.ADMIN)
    sessions = {"one": login_as("one@example.test"), "two": login_as("two@example.test")}
    targets = {"one": two.id, "two": one.id}  # each tries to deactivate the other
    barrier = threading.Barrier(2)

    def run(who: str) -> tuple[int, str]:
        barrier.wait()
        response = sessions[who].patch(f"{A}/users/{targets[who]}", json={"is_active": False})
        body = response.json()
        return response.status_code, body.get("error", {}).get("code", "")

    with ThreadPoolExecutor(2) as pool:
        results = sorted(pool.map(run, ["one", "two"]))
    assert results == [(200, ""), (409, "LAST_ADMIN")]
    db.expire_all()
    active = db.scalars(select(User).where(User.role == Role.ADMIN, User.is_active)).all()
    assert len(active) == 1  # somebody is always left in charge


def test_a_manager_with_reports_cannot_be_demoted_or_deactivated(
    admin: TestClient, db: Session
) -> None:
    boss = make_user(db, "boss@example.test", Role.MANAGER)
    for n in range(2):
        make_user(db, f"r{n}@example.test").manager_id = boss.id
    db.commit()
    demote = admin.patch(f"{A}/users/{boss.id}", json={"role": "EMPLOYEE"})
    off = admin.patch(f"{A}/users/{boss.id}", json={"is_active": False})
    for response in (demote, off):
        assert response.status_code == 422
        assert "Reassign their 2 active reports first" in str(
            response.json()["error"]["field_errors"]
        )
    # After reassigning them, it works.
    other = make_user(db, "other@example.test", Role.MANAGER)
    for n in range(2):
        r = db.scalars(select(User).where(User.email == f"r{n}@example.test")).one()
        assert (
            admin.patch(f"{A}/users/{r.id}", json={"manager_id": str(other.id)}).status_code == 200
        )
    assert admin.patch(f"{A}/users/{boss.id}", json={"is_active": False}).status_code == 200


def test_deactivation_signs_the_person_out_everywhere_and_blocks_login(
    admin: TestClient, db: Session, login_as: Any, make_client: Any, settings: Any
) -> None:
    victim = make_user(db, "victim@example.test")
    first = login_as("victim@example.test")
    second = login_as("victim@example.test")
    assert first.get(f"{API}/auth/me").status_code == 200

    assert admin.patch(f"{A}/users/{victim.id}", json={"is_active": False}).status_code == 200
    assert first.get(f"{API}/auth/me").status_code == 401
    assert second.get(f"{API}/auth/me").status_code == 401
    db.expire_all()
    assert all(
        s.revoked_at
        for s in db.scalars(select(AuthSession).where(AuthSession.user_id == victim.id))
    )
    refused = make_client(settings)
    assert (
        refused.post(
            f"{API}/auth/login", json={"email": "victim@example.test", "password": PASSWORD}
        ).status_code
        == 401
    )

    # History is untouched and the account can come back.
    [event] = audit_rows(db, entity_id=victim.id)
    assert event.action is ConfigAction.DEACTIVATED
    assert admin.patch(f"{A}/users/{victim.id}", json={"is_active": True}).status_code == 200
    assert audit_rows(db, entity_id=victim.id)[-1].action is ConfigAction.REACTIVATED
    assert login_as("victim@example.test").get(f"{API}/auth/me").status_code == 200


def test_assignment_changes_who_can_review(
    admin: TestClient, db: Session, login_as: Any, world: Any
) -> None:
    from app.tests.support import payload

    boss1 = make_user(db, "boss1@example.test", Role.MANAGER)
    boss2 = make_user(db, "boss2@example.test", Role.MANAGER)
    world.user.manager_id = boss1.id
    db.commit()
    emp = login_as("emp@example.test")
    emp.post(f"{API}/time-entries", json=payload(world))
    emp.post(f"{API}/timesheets/weeks/2026-10-21/submit", json={})
    m1, m2 = login_as("boss1@example.test"), login_as("boss2@example.test")
    assert m1.get(f"{API}/approvals").json()["total"] == 1
    assert m2.get(f"{API}/approvals").json()["total"] == 0
    assert (
        admin.patch(f"{A}/users/{world.user.id}", json={"manager_id": str(boss2.id)}).status_code
        == 200
    )
    assert m1.get(f"{API}/approvals").json()["total"] == 0
    assert m2.get(f"{API}/approvals").json()["total"] == 1
    assert admin.patch(f"{A}/users/{world.user.id}", json={"manager_id": None}).status_code == 200
    assert m2.get(f"{API}/approvals").json()["total"] == 0


# ---------------------------------------------------------------------- reset password


def test_resetting_a_password_ends_sessions_and_forces_a_change(
    admin: TestClient, db: Session, login_as: Any, make_client: Any, settings: Any
) -> None:
    person = make_user(db, "p@example.test")
    old_session = login_as("p@example.test")
    response = admin.post(f"{A}/users/{person.id}/reset-password")
    assert response.status_code == 200
    temporary = response.json()["temporary_password"]
    assert old_session.get(f"{API}/auth/me").status_code == 401  # signed out immediately

    fresh = make_client(settings)
    assert (
        fresh.post(
            f"{API}/auth/login", json={"email": "p@example.test", "password": PASSWORD}
        ).status_code
        == 401
    )
    assert (
        fresh.post(
            f"{API}/auth/login", json={"email": "p@example.test", "password": temporary}
        ).status_code
        == 200
    )
    assert fresh.get(f"{API}/auth/me").json()["must_change_password"] is True
    [event] = audit_rows(db, entity_id=person.id)
    assert event.action is ConfigAction.PASSWORD_RESET
    assert temporary not in str(event.details)


def test_you_cannot_reset_your_own_password_through_the_admin_route(
    admin: TestClient, db: Session
) -> None:
    me = db.scalars(select(User).where(User.email == "admin@example.test")).one()
    assert admin.post(f"{A}/users/{me.id}/reset-password").status_code == 422


def test_audit_rows_cannot_be_changed_or_removed(admin: TestClient, db: Session) -> None:
    new_user(admin)
    from sqlalchemy.exc import DBAPIError

    for statement in (
        "UPDATE config_audit_events SET created_at = now()",
        "DELETE FROM config_audit_events",
    ):
        with pytest.raises(DBAPIError, match="append-only"):
            db.execute(text(statement))
        db.rollback()
