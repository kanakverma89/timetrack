from __future__ import annotations

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, func, inspect, select
from sqlalchemy.engine import URL
from sqlalchemy.orm import Session

from app.db_admin import assert_disposable, downgrade_database, recreate_database, upgrade_database
from app.models import Base, Project, TimeEntry, User
from app.seeding import seed

EXPECTED_TABLES = {
    "users",
    "auth_sessions",
    "teams",
    "team_memberships",
    "projects",
    "project_tasks",
    "earning_codes",
    "timesheet_weeks",
    "time_entries",
    "time_entry_events",
    "idempotency_keys",
    "approval_events",
    "notification_outbox",
}


@pytest.fixture
def scratch_url(test_url: URL) -> URL:
    return test_url.set(database="timetrack_migrate_test")


def test_migrations_apply_from_empty_database_and_match_models(scratch_url: URL) -> None:
    recreate_database(scratch_url)
    upgrade_database(scratch_url)
    engine = create_engine(scratch_url)
    try:
        tables = set(inspect(engine).get_table_names()) - {"alembic_version"}
        assert tables == EXPECTED_TABLES
        with engine.connect() as conn:
            diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
        assert diff == [], f"models and migrations have drifted: {diff}"
    finally:
        engine.dispose()


def test_migrations_downgrade_to_base_and_reapply(scratch_url: URL) -> None:
    recreate_database(scratch_url)
    upgrade_database(scratch_url)
    downgrade_database(scratch_url)
    engine = create_engine(scratch_url)
    try:
        assert set(inspect(engine).get_table_names()) - {"alembic_version"} == set()
    finally:
        engine.dispose()
    upgrade_database(scratch_url)


def test_destructive_helpers_refuse_non_disposable_database_names() -> None:
    for name in ("timetrack", "production", None, "x_test_not"):
        with pytest.raises(RuntimeError):
            assert_disposable(name)
    assert assert_disposable("timetrack_test") == "timetrack_test"
    assert assert_disposable("anything_e2e") == "anything_e2e"


def test_seed_is_idempotent_and_requires_strong_password(db: Session) -> None:
    with pytest.raises(ValueError):
        seed(db, password="short", sample_entries=False)

    seed(db, password="a-sufficiently-long-seed-password", sample_entries=True)
    counts = (
        db.scalar(select(func.count()).select_from(User)),
        db.scalar(select(func.count()).select_from(Project)),
        db.scalar(select(func.count()).select_from(TimeEntry)),
    )
    seed(db, password="a-sufficiently-long-seed-password", sample_entries=True)
    again = (
        db.scalar(select(func.count()).select_from(User)),
        db.scalar(select(func.count()).select_from(Project)),
        db.scalar(select(func.count()).select_from(TimeEntry)),
    )
    assert counts == again == (6, 4, 22)


def test_seed_uses_only_reserved_example_domain(db: Session) -> None:
    seed(db, password="a-sufficiently-long-seed-password", sample_entries=False)
    emails = [u.email for u in db.scalars(select(User))]
    assert emails and all(e.endswith("@example.test") for e in emails)
