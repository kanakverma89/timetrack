"""Pure validation rules for a single time entry (no database access)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from app.services import weeks

TWO_PLACES = Decimal("0.01")


def check_hours(hours: Decimal, maximum: Decimal) -> str | None:
    if hours <= 0:
        return "Hours must be greater than zero."
    if hours > maximum:
        return f"Hours cannot exceed {maximum.normalize():f} per entry."
    if hours != hours.quantize(TWO_PLACES):
        return "Hours can have at most two decimal places."
    return None


def check_description(description: str, maximum: int) -> str | None:
    if not description.strip():
        return "Description is required."
    if len(description.strip()) > maximum:
        return f"Description must be {maximum} characters or fewer."
    return None


def check_work_date_supported(day: date) -> str | None:
    if not weeks.is_supported_date(day):
        return f"Date must be between {weeks.MIN_YEAR} and {weeks.MAX_YEAR}."
    return None
