"""Pure rules applied when a week is submitted (no database access)."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from app.services import entry_rules

ZERO = Decimal("0.00")


@dataclass(frozen=True)
class EntryView:
    """The parts of a stored entry that are re-checked at submission."""

    id: str
    work_date: date
    hours: Decimal
    description: str


def _fmt(value: Decimal) -> str:
    return f"{value.quantize(Decimal('0.01'))}"


def check_entries(
    entries: Sequence[EntryView],
    *,
    week_start: date,
    week_end: date,
    max_hours_per_entry: Decimal,
    description_max: int,
) -> dict[str, str]:
    """Re-validate stored entries against *current* rules (limits may have changed since writing).

    Keys are ``entries.<entry id>.<field>`` so a client can point at the offending entry.
    """
    errors: dict[str, str] = {}
    for entry in entries:
        if not (week_start <= entry.work_date <= week_end):
            errors[f"entries.{entry.id}.work_date"] = "Date is outside this week."
        if message := entry_rules.check_hours(entry.hours, max_hours_per_entry):
            errors[f"entries.{entry.id}.hours"] = message
        if message := entry_rules.check_description(entry.description, description_max):
            errors[f"entries.{entry.id}.description"] = message
    return errors


def check_policy(
    entries: Sequence[EntryView],
    *,
    max_hours_per_day: Decimal | None,
    max_hours_per_week: Decimal | None,
) -> dict[str, str]:
    """Optional configured weekly policy. A limit of ``None`` means "no rule"."""
    errors: dict[str, str] = {}
    per_day: dict[date, Decimal] = {}
    for entry in entries:
        per_day[entry.work_date] = per_day.get(entry.work_date, ZERO) + entry.hours

    if max_hours_per_day is not None:
        for day, total in sorted(per_day.items()):
            if total > max_hours_per_day:
                errors[f"day.{day.isoformat()}"] = (
                    f"Total for this day is {_fmt(total)} h, above the daily limit of "
                    f"{_fmt(max_hours_per_day)} h."
                )
    week_total = sum(per_day.values(), ZERO)
    if max_hours_per_week is not None and week_total > max_hours_per_week:
        errors["week"] = (
            f"Total for the week is {_fmt(week_total)} h, above the weekly limit of "
            f"{_fmt(max_hours_per_week)} h."
        )
    return errors
