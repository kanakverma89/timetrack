"""Application settings, loaded from environment variables (and an optional .env file)."""

from __future__ import annotations

import enum
from decimal import Decimal
from functools import lru_cache
from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

PLACEHOLDER_MARKERS = ("replace-with", "change-me")
MIN_SECRET_LENGTH = 32


class WeekStartDay(enum.IntEnum):
    """Matches ``datetime.date.weekday()`` (Monday = 0)."""

    MONDAY = 0
    TUESDAY = 1
    WEDNESDAY = 2
    THURSDAY = 3
    FRIDAY = 4
    SATURDAY = 5
    SUNDAY = 6


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_env: Literal["development", "test", "production"] = "development"
    app_name: str = "TimeTrack"
    api_v1_prefix: str = "/api/v1"
    log_level: str = "INFO"
    enable_docs: bool | None = None

    database_url: str = "postgresql+psycopg://timetrack:change-me@localhost:5432/timetrack"
    test_database_url: str | None = None

    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:5173"]
    auth_mode: Literal["local"] = "local"
    session_secret: str = "replace-with-a-long-random-secret"  # noqa: S105 - placeholder
    session_ttl_hours: int = Field(default=12, ge=1, le=24 * 30)
    session_cookie_name: str = "timetrack_session"
    login_max_attempts: int = Field(default=5, ge=1)
    login_window_seconds: int = Field(default=900, ge=1)

    business_timezone: str = "Asia/Kolkata"
    week_start_day: WeekStartDay = WeekStartDay.MONDAY
    max_hours_per_entry: Decimal = Field(default=Decimal("24"), gt=0, le=24)
    description_max_length: int = Field(default=256, ge=1, le=256)

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [part.strip() for part in value.split(",") if part.strip()]
        return value

    @field_validator("week_start_day", mode="before")
    @classmethod
    def _parse_week_start(cls, value: object) -> object:
        if isinstance(value, str):
            try:
                return WeekStartDay[value.strip().upper()]
            except KeyError as exc:
                raise ValueError("WEEK_START_DAY must be a weekday name, e.g. MONDAY") from exc
        return value

    @field_validator("business_timezone")
    @classmethod
    def _check_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError(f"Unknown BUSINESS_TIMEZONE: {value}") from exc
        return value

    @model_validator(mode="after")
    def _validate_production(self) -> Settings:
        if self.app_env != "production":
            return self
        problems: list[str] = []
        if len(self.session_secret) < MIN_SECRET_LENGTH or any(
            m in self.session_secret for m in PLACEHOLDER_MARKERS
        ):
            problems.append(
                f"SESSION_SECRET must be a random value of >= {MIN_SECRET_LENGTH} chars"
            )
        if any(m in self.database_url for m in PLACEHOLDER_MARKERS):
            problems.append("DATABASE_URL still contains a placeholder password")
        if any(origin == "*" for origin in self.cors_origins):
            problems.append("CORS_ORIGINS must not contain '*' when credentials are used")
        if any(not o.startswith("https://") for o in self.cors_origins):
            problems.append("CORS_ORIGINS must use https:// in production")
        if problems:
            raise ValueError("Invalid production configuration: " + "; ".join(problems))
        return self

    @property
    def docs_enabled(self) -> bool:
        if self.enable_docs is not None:
            return self.enable_docs
        return self.app_env != "production"

    @property
    def cookie_secure(self) -> bool:
        return self.app_env == "production"

    @property
    def tzinfo(self) -> ZoneInfo:
        return ZoneInfo(self.business_timezone)


@lru_cache
def get_settings() -> Settings:
    return Settings()
