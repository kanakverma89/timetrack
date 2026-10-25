"""Retention purge, user anonymisation and admin bootstrap, against a real database."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.maintenance import MaintenanceError, anonymise_user, create_admin, purge
from app.models import (
    AuthSession,
    ConfigAuditEvent,
    IdempotencyKey,
    NotificationOutbox,
    OutboxStatus,
    Role,
    TimeEntry,
    TimeEntryEvent,
    User,
    WeekStatus,
)
from app.tests.factories import (
    PASSWORD,
    make_earning,
    make_entry,
    make_project,
    make_user,
    make_week,
)
from app.tests.support import API, count

NOW = datetime(2026, 10, 24, 12, 0, tzinfo=UTC)


def days_ago(n: int) -> datetime:
    return NOW - timedelta(days=n)


def add_session(
    db: Session, user: User, digest: str, *, expires: datetime, revoked: datetime | None = None
) -> None:
    db.add(
        AuthSession(user_id=user.id, token_digest=digest, expires_at=expires, revoked_at=revoked)
    )
    db.commit()


# ------------------------------------------------------------------------------------- purge


def test_purge_removes_only_sessions_that_ended_long_enough_ago(db: Session) -> None:
    user = make_user(db)
    add_session(db, user, "live", expires=NOW + timedelta(days=1))
    add_session(db, user, "expired-recently", expires=days_ago(5))
    add_session(db, user, "expired-long-ago", expires=days_ago(31))
    add_session(db, user, "revoked-long-ago", expires=NOW + timedelta(days=1), revoked=days_ago(40))
    add_session(db, user, "revoked-recently", expires=NOW + timedelta(days=1), revoked=days_ago(2))

    result = purge(db, now=NOW)

    assert result.sessions == 2
    left = set(db.scalars(select(AuthSession.token_digest)))
    assert left == {"live", "expired-recently", "revoked-recently"}


def test_purge_keeps_outbox_rows_that_still_matter(db: Session) -> None:
    def row(status: OutboxStatus, processed: datetime | None) -> None:
        db.add(
            NotificationOutbox(
                event_type="x",
                aggregate_id=uuid.uuid4(),
                payload={},
                status=status,
                processed_at=processed,
            )
        )
        db.commit()

    row(OutboxStatus.SENT, days_ago(60))  # deleted
    row(OutboxStatus.SENT, days_ago(3))  # too recent
    row(OutboxStatus.PENDING, None)  # work still to do
    row(OutboxStatus.FAILED, days_ago(90))  # evidence of a problem: never purged
    row(OutboxStatus.PROCESSING, days_ago(90))  # possibly in flight

    result = purge(db, now=NOW)

    assert result.outbox == 1
    assert count(db, NotificationOutbox) == 4
    assert OutboxStatus.SENT in set(db.scalars(select(NotificationOutbox.status)))


def test_purge_removes_old_idempotency_keys_only(db: Session) -> None:
    user = make_user(db)
    week = make_week(db, user, date(2026, 10, 19), WeekStatus.SUBMITTED)
    for key, age in (("old", 45), ("fresh", 1)):
        db.add(
            IdempotencyKey(
                user_id=user.id,
                scope="submit",
                key=key,
                aggregate_id=week.id,
                created_at=days_ago(age),
            )
        )
    db.commit()

    assert purge(db, now=NOW).idempotency_keys == 1
    assert [k.key for k in db.scalars(select(IdempotencyKey))] == ["fresh"]


def test_a_dry_run_counts_but_deletes_nothing(db: Session) -> None:
    user = make_user(db)
    add_session(db, user, "old", expires=days_ago(100))

    result = purge(db, dry_run=True, now=NOW)

    assert result.sessions == 1
    assert count(db, AuthSession) == 1
    assert purge(db, now=NOW).sessions == 1  # the real run finds exactly what the dry run promised
    assert count(db, AuthSession) == 0


def test_purge_is_idempotent_and_never_touches_the_audit_trails(db: Session) -> None:
    user = make_user(db)
    week = make_week(db, user, date(2026, 10, 19))
    project, earning = make_project(db), make_earning(db)
    entry = make_entry(db, week, project, earning, date(2026, 10, 19))
    db.add(
        TimeEntryEvent(
            timesheet_week_id=week.id,
            time_entry_id=entry.id,
            actor_id=user.id,
            action="CREATED",
            details={},
            created_at=days_ago(900),
        )
    )
    db.commit()
    audit_before = (count(db, TimeEntryEvent), count(db, ConfigAuditEvent), count(db, TimeEntry))

    purge(db, session_days=1, idempotency_days=1, outbox_days=1, now=NOW)
    second = purge(db, session_days=1, idempotency_days=1, outbox_days=1, now=NOW)

    assert second.total == 0
    assert (
        count(db, TimeEntryEvent),
        count(db, ConfigAuditEvent),
        count(db, TimeEntry),
    ) == audit_before


@pytest.mark.parametrize("bad", [0, -1])
def test_purge_refuses_a_retention_window_that_would_delete_everything(
    db: Session, bad: int
) -> None:
    with pytest.raises(MaintenanceError):
        purge(db, session_days=bad)


# --------------------------------------------------------------------------------- anonymise


def test_anonymising_removes_identity_but_keeps_hours_and_history(db: Session) -> None:
    former = make_user(db, "leaver@example.test", active=False)
    week = make_week(db, former, date(2026, 10, 19), WeekStatus.APPROVED)
    entry = make_entry(db, week, make_project(db), make_earning(db), date(2026, 10, 19), "7.50")
    add_session(db, former, "old-session", expires=NOW)

    anonymise_user(db, former.id)

    db.expire_all()
    after = db.get(User, former.id)
    assert after is not None
    assert after.display_name == "Former employee"
    assert "leaver" not in after.email and after.email.endswith("@anonymised.invalid")
    assert after.password_hash is None and after.is_active is False
    assert count(db, AuthSession) == 0
    assert str(db.get(TimeEntry, entry.id).hours) == "7.50"  # type: ignore[union-attr]
    assert db.get(type(week), week.id).status is WeekStatus.APPROVED  # type: ignore[union-attr]


def test_an_anonymised_user_can_no_longer_sign_in(client: TestClient, db: Session) -> None:
    former = make_user(db, "leaver@example.test", active=False)
    anonymise_user(db, former.id)
    for email in ("leaver@example.test", f"user-{former.id}@anonymised.invalid"):
        response = client.post(f"{API}/auth/login", json={"email": email, "password": PASSWORD})
        assert response.status_code == 401


def test_only_deactivated_users_without_reports_can_be_anonymised(db: Session) -> None:
    active = make_user(db, "active@example.test")
    with pytest.raises(MaintenanceError, match="Deactivate"):
        anonymise_user(db, active.id)

    boss = make_user(db, "boss@example.test", Role.MANAGER, active=False)
    report = make_user(db, "rep@example.test")
    report.manager_id = boss.id
    db.commit()
    with pytest.raises(MaintenanceError, match="reports"):
        anonymise_user(db, boss.id)

    with pytest.raises(MaintenanceError, match="No such user"):
        anonymise_user(db, uuid.uuid4())


def test_anonymising_twice_is_refused_rather_than_silently_repeated(db: Session) -> None:
    former = make_user(db, "leaver@example.test", active=False)
    anonymise_user(db, former.id)
    with pytest.raises(MaintenanceError, match="already"):
        anonymise_user(db, former.id)


def test_the_admin_audit_trail_holds_no_personal_data_to_survive_anonymisation(
    db: Session, login_as: Callable[[str], TestClient]
) -> None:
    make_user(db, "admin@example.test", Role.ADMIN)
    admin = login_as("admin@example.test")
    created = admin.post(
        f"{API}/admin/users",
        json={
            "email": "private.person@example.test",
            "display_name": "Private Person",
            "role": "EMPLOYEE",
            "manager_id": None,
        },
    ).json()["user"]
    admin.patch(f"{API}/admin/users/{created['id']}", json={"display_name": "Renamed Person"})
    admin.patch(f"{API}/admin/users/{created['id']}", json={"is_active": False})
    admin.post(f"{API}/admin/users/{created['id']}/reset-password")

    stored = " ".join(str(e.details) for e in db.scalars(select(ConfigAuditEvent)))
    for secret in ("private.person", "Private Person", "Renamed Person"):
        assert secret not in stored

    anonymise_user(db, uuid.UUID(created["id"]))
    listing = admin.get(f"{API}/admin/audit", params={"entity_id": created["id"]}).json()["items"]
    assert listing and {i["entity_label"] for i in listing} == {"Former employee"}
    assert "private.person" not in str(listing) and "Renamed Person" not in str(listing)


# ------------------------------------------------------------------------------ create-admin


def test_create_admin_makes_an_active_admin_who_must_change_the_password(db: Session) -> None:
    user = create_admin(
        db,
        email="  Boss@Example.TEST ",
        display_name=" Ada Boss ",
        password="a-long-unusual-passphrase-7",
    )
    assert (user.email, user.display_name, user.role) == (
        "boss@example.test",
        "Ada Boss",
        Role.ADMIN,
    )
    assert user.is_active and user.must_change_password
    assert user.password_hash and "unusual" not in user.password_hash


def test_the_new_admin_can_sign_in_and_is_forced_to_change_the_password(
    client: TestClient, db: Session
) -> None:
    create_admin(
        db, email="boss@example.test", display_name="Boss", password="a-long-unusual-passphrase-7"
    )
    login = client.post(
        f"{API}/auth/login",
        json={"email": "boss@example.test", "password": "a-long-unusual-passphrase-7"},
    )
    assert login.status_code == 200 and login.json()["must_change_password"] is True
    assert client.get(f"{API}/admin/users").status_code == 403  # blocked until it is changed


@pytest.mark.parametrize(
    ("email", "name", "password", "message"),
    [
        ("not-an-email", "Boss", "a-long-unusual-passphrase-7", "email"),
        ("boss@example.test", "   ", "a-long-unusual-passphrase-7", "display name"),
        ("boss@example.test", "Boss", "short", "Password rejected"),
        ("boss@example.test", "Boss", "", "Password rejected"),
        ("boss@example.test", "Boss", "boss@example.test", "Password rejected"),
    ],
)
def test_create_admin_validates_everything_and_creates_nothing_on_failure(
    db: Session, email: str, name: str, password: str, message: str
) -> None:
    with pytest.raises(MaintenanceError, match=message):
        create_admin(db, email=email, display_name=name, password=password)
    assert count(db, User) == 0


def test_create_admin_refuses_an_existing_email(db: Session) -> None:
    make_user(db, "boss@example.test")
    with pytest.raises(MaintenanceError, match="already exists"):
        create_admin(
            db, email="BOSS@example.test", display_name="B", password="a-long-unusual-passphrase-7"
        )


def test_the_cli_reads_the_password_from_the_environment_and_never_prints_it(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    db: Session,
    test_url: object,
) -> None:
    import importlib.util
    from pathlib import Path

    spec = importlib.util.spec_from_file_location(
        "maintain", Path(__file__).resolve().parents[2] / "scripts" / "maintain.py"
    )
    assert spec and spec.loader
    cli = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cli)
    from sqlalchemy.orm import sessionmaker

    monkeypatch.setattr(
        cli, "get_sessionmaker", lambda: sessionmaker(bind=db.get_bind(), expire_on_commit=False)
    )
    monkeypatch.setenv("ADMIN_PASSWORD", "a-long-unusual-passphrase-7")

    assert cli.main(["create-admin", "cli@example.test", "Cli Admin"]) == 0
    assert cli.main(["create-admin", "cli@example.test", "Cli Admin"]) == 1  # duplicate -> error
    out = capsys.readouterr()
    assert "unusual" not in out.out + out.err
    assert "already exists" in out.err
    assert cli.main(["anonymise-user", "cli@example.test"]) == 2  # no --confirm
    assert cli.main(["purge", "--dry-run"]) == 0
    assert db.scalar(text("select count(*) from users where role = 'ADMIN'")) == 1
