"""Pure week/date arithmetic. No database or clock access except where a clock is passed in."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from app.core.config import WeekStartDay

MIN_YEAR = 1970
MAX_YEAR = 2100


def week_start_for(day: date, week_start_day: WeekStartDay) -> date:
    """First date of the seven-day week containing ``day``."""
    offset = (day.weekday() - int(week_start_day)) % 7
    return day - timedelta(days=offset)


def week_end_for(week_start: date) -> date:
    return week_start + timedelta(days=6)


def week_dates(week_start: date) -> list[date]:
    return [week_start + timedelta(days=i) for i in range(7)]


def business_today(tz: ZoneInfo, now: datetime | None = None) -> date:
    """Current business date in ``tz`` (never derived from UTC date directly)."""
    current = now.astimezone(tz) if now is not None else datetime.now(tz)
    return current.date()


def is_supported_date(day: date) -> bool:
    return MIN_YEAR <= day.year <= MAX_YEAR
