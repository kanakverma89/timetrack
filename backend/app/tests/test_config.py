from __future__ import annotations

from typing import Any

import pytest
from pydantic import ValidationError

from app.core.config import Settings, WeekStartDay

GOOD_SECRET = "x" * 48


@pytest.fixture(autouse=True)
def _hermetic_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ignore any Settings-related variables exported in the developer's shell."""
    for name in Settings.model_fields:
        monkeypatch.delenv(name.upper(), raising=False)


def build(**kwargs: Any) -> Settings:
    base: dict[str, Any] = {
        "app_env": "development",
        "database_url": "postgresql+psycopg://u:p@localhost/db",
        "session_secret": GOOD_SECRET,
        "cors_origins": "http://localhost:5173",
    }
    base.update(kwargs)
    return Settings(_env_file=None, **base)


def production(**kwargs: Any) -> Settings:
    base: dict[str, Any] = {
        "app_env": "production",
        "database_url": "postgresql+psycopg://u:realpassword@db/app",
        "cors_origins": "https://app.example.test",
    }
    base.update(kwargs)
    return build(**base)


def test_cors_origins_are_split_from_comma_separated_string() -> None:
    s = build(cors_origins="http://a.test, http://b.test ,")
    assert s.cors_origins == ["http://a.test", "http://b.test"]


def test_week_start_day_parses_names_case_insensitively() -> None:
    assert build(week_start_day="sunday").week_start_day is WeekStartDay.SUNDAY
    assert build().week_start_day is WeekStartDay.MONDAY


def test_invalid_week_start_day_rejected() -> None:
    with pytest.raises(ValidationError):
        build(week_start_day="FUNDAY")


def test_invalid_timezone_rejected() -> None:
    with pytest.raises(ValidationError):
        build(business_timezone="Mars/Olympus")


def test_valid_production_config_accepted_and_hardened_defaults() -> None:
    s = production()
    assert s.cookie_secure is True
    assert s.docs_enabled is False


def test_docs_enabled_by_default_outside_production() -> None:
    assert build().docs_enabled is True
    assert build(enable_docs=False).docs_enabled is False


@pytest.mark.parametrize(
    "overrides",
    [
        {"session_secret": "replace-with-a-long-random-secret"},
        {"session_secret": "short"},
        {"database_url": "postgresql+psycopg://u:change-me@db/app"},
        {"cors_origins": "*"},
        {"cors_origins": "http://insecure.example.test"},
    ],
)
def test_production_rejects_unsafe_configuration(overrides: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        production(**overrides)


def test_max_hours_and_description_limits_are_bounded() -> None:
    with pytest.raises(ValidationError):
        build(max_hours_per_entry="25")
    with pytest.raises(ValidationError):
        build(description_max_length=500)  # DB column is VARCHAR(256)
