from __future__ import annotations

from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

import pytest

from app.core.config import WeekStartDay
from app.services import weeks


@pytest.mark.parametrize(
    ("day", "expected"),
    [
        ("2026-10-19", "2026-10-19"),  # Monday itself
        ("2026-10-21", "2026-10-19"),  # midweek
        ("2026-10-25", "2026-10-19"),  # Sunday belongs to the week that started Monday
        ("2026-01-01", "2025-12-29"),  # year boundary
        ("2026-03-01", "2026-02-23"),  # month boundary (non-leap February)
        ("2024-03-01", "2024-02-26"),  # leap year
        ("2024-02-29", "2024-02-26"),  # leap day
        ("2028-01-02", "2027-12-27"),  # Sunday across year boundary
    ],
)
def test_week_start_monday_first(day: str, expected: str) -> None:
    assert weeks.week_start_for(date.fromisoformat(day), WeekStartDay.MONDAY) == date.fromisoformat(
        expected
    )


@pytest.mark.parametrize(
    ("start_day", "day", "expected"),
    [
        (WeekStartDay.SUNDAY, "2026-10-25", "2026-10-25"),
        (WeekStartDay.SUNDAY, "2026-10-24", "2026-10-18"),
        (WeekStartDay.SATURDAY, "2026-10-23", "2026-10-17"),
        (WeekStartDay.WEDNESDAY, "2026-10-21", "2026-10-21"),
    ],
)
def test_week_start_other_start_days(start_day: WeekStartDay, day: str, expected: str) -> None:
    assert weeks.week_start_for(date.fromisoformat(day), start_day) == date.fromisoformat(expected)


@pytest.mark.parametrize("start_day", list(WeekStartDay))
def test_week_is_seven_days_starting_on_configured_day(start_day: WeekStartDay) -> None:
    start = weeks.week_start_for(date(2026, 10, 23), start_day)
    assert start.weekday() == int(start_day)
    dates = weeks.week_dates(start)
    assert len(dates) == 7
    assert dates[0] == start
    assert weeks.week_end_for(start) == dates[-1]
    assert (dates[-1] - dates[0]).days == 6


def test_business_today_uses_business_timezone_not_utc() -> None:
    # 20:00 UTC on Oct 22 is already 01:30 on Oct 23 in Kolkata (UTC+5:30).
    now = datetime(2026, 10, 22, 20, 0, tzinfo=UTC)
    assert weeks.business_today(ZoneInfo("Asia/Kolkata"), now) == date(2026, 10, 23)
    # 03:00 UTC on Oct 23 is still Oct 22 in Los Angeles (UTC-7).
    now = datetime(2026, 10, 23, 3, 0, tzinfo=UTC)
    assert weeks.business_today(ZoneInfo("America/Los_Angeles"), now) == date(2026, 10, 22)


def test_supported_date_bounds() -> None:
    assert weeks.is_supported_date(date(1970, 1, 1))
    assert weeks.is_supported_date(date(2100, 12, 31))
    assert not weeks.is_supported_date(date(1969, 12, 31))
    assert not weeks.is_supported_date(date.max)
