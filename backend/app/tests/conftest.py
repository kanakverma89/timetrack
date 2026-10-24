from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings
from app.core.db import get_db
from app.db_admin import assert_disposable, recreate_database, upgrade_database
from app.main import create_app
from app.models import Base, Classification
from app.tests.factories import (
    login,
    make_earning,
    make_project,
    make_task,
    make_user,
)
from app.tests.support import World

TEST_SESSION_SECRET = "test-only-secret-not-used-anywhere-else-0123456789"  # noqa: S105
TEST_ORIGIN = "http://localhost:5173"


def _test_url() -> URL:
    base = Settings(_env_file=None)
    if base.test_database_url:
        url = make_url(base.test_database_url)
    else:
        url = make_url(base.database_url).set(database="timetrack_test")
    assert_disposable(url.database)
    return url


@pytest.fixture(scope="session")
def test_url() -> URL:
    return _test_url()


@pytest.fixture(scope="session")
def engine(test_url: URL) -> Iterator[Engine]:
    """Disposable database created from scratch by running the real Alembic migrations."""
    recreate_database(test_url)
    upgrade_database(test_url)
    eng = create_engine(test_url)
    yield eng
    eng.dispose()


@pytest.fixture(autouse=True)
def _clean_tables(engine: Engine) -> None:
    names = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE TABLE {names} RESTART IDENTITY CASCADE"))


@pytest.fixture
def db(engine: Engine) -> Iterator[Session]:
    with Session(engine, expire_on_commit=False) as session:
        yield session


def make_settings(test_url: URL, **overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "app_env": "test",
        "database_url": test_url.render_as_string(hide_password=False),
        "session_secret": TEST_SESSION_SECRET,
        "cors_origins": [TEST_ORIGIN],
        "business_timezone": "Asia/Kolkata",
        "week_start_day": "MONDAY",
        "login_max_attempts": 5,
        "login_window_seconds": 900,
        "log_level": "CRITICAL",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


@pytest.fixture
def settings(test_url: URL) -> Settings:
    return make_settings(test_url)


@pytest.fixture
def make_client(engine: Engine) -> Any:
    """Factory building a TestClient for an app created with the given settings."""
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def _make(settings: Settings, **client_kwargs: Any) -> TestClient:
        app = create_app(settings)

        def _get_db() -> Iterator[Session]:
            session = factory()
            try:
                yield session
            except Exception:
                session.rollback()
                raise
            finally:
                session.close()

        app.dependency_overrides[get_db] = _get_db
        client_kwargs.setdefault("headers", {"X-Requested-With": "timetrack"})
        return TestClient(app, **client_kwargs)

    return _make


@pytest.fixture
def client(make_client: Any, settings: Settings) -> TestClient:
    result: TestClient = make_client(settings)
    return result


@pytest.fixture
def world(db: Session) -> World:
    """An employee, a project with one task, a task-less project and two earning codes."""
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
