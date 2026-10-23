"""Helpers to create/drop disposable databases and run migrations programmatically."""

from __future__ import annotations

from pathlib import Path

from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL

from alembic import command

SAFE_SUFFIXES = ("_test", "_e2e")
BACKEND_DIR = Path(__file__).resolve().parent.parent


def assert_disposable(name: str | None) -> str:
    if not name or not name.endswith(SAFE_SUFFIXES):
        raise RuntimeError(
            f"Refusing to touch database {name!r}: name must end with one of {SAFE_SUFFIXES}."
        )
    return name


def recreate_database(url: URL) -> None:
    name = assert_disposable(url.database)
    admin = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        conn.execute(text(f'CREATE DATABASE "{name}"'))
    admin.dispose()


def upgrade_database(url: URL, revision: str = "head") -> None:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.set_main_option(
        "sqlalchemy.url", url.render_as_string(hide_password=False).replace("%", "%%")
    )
    command.upgrade(cfg, revision)


def downgrade_database(url: URL, revision: str = "base") -> None:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.set_main_option(
        "sqlalchemy.url", url.render_as_string(hide_password=False).replace("%", "%%")
    )
    command.downgrade(cfg, revision)
