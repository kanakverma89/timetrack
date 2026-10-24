from __future__ import annotations

from datetime import date
from decimal import Decimal

from app.services import submission_rules as rules
from app.services.submission_rules import EntryView

MON, SUN = date(2026, 10, 19), date(2026, 10, 25)


def entry(day: str, hours: str, description: str = "Work", entry_id: str = "e1") -> EntryView:
    return EntryView(entry_id, date.fromisoformat(day), Decimal(hours), description)


def test_valid_entries_have_no_errors() -> None:
    errors = rules.check_entries(
        [entry("2026-10-19", "8"), entry("2026-10-25", "0.01", entry_id="e2")],
        week_start=MON,
        week_end=SUN,
        max_hours_per_entry=Decimal("24"),
        description_max=256,
    )
    assert errors == {}


def test_entries_are_rechecked_against_the_current_limits() -> None:
    errors = rules.check_entries(
        [
            entry("2026-10-19", "8", entry_id="a"),
            entry("2026-10-26", "1", entry_id="b"),  # outside the week
            entry("2026-10-20", "1", description="x" * 11, entry_id="c"),
        ],
        week_start=MON,
        week_end=SUN,
        max_hours_per_entry=Decimal("6"),  # tightened since "a" was written
        description_max=10,
    )
    assert set(errors) == {
        "entries.a.hours",
        "entries.b.work_date",
        "entries.c.description",
    }
    assert "6" in errors["entries.a.hours"]


def test_no_policy_means_no_limits() -> None:
    heavy = [entry(f"2026-10-{19 + d}", "24", entry_id=str(d)) for d in range(7)]
    assert rules.check_policy(heavy, max_hours_per_day=None, max_hours_per_week=None) == {}


def test_daily_limit_is_per_date_and_sums_entries() -> None:
    entries = [
        entry("2026-10-20", "9", entry_id="a"),
        entry("2026-10-20", "8", entry_id="b"),  # 17 on the 20th
        entry("2026-10-21", "16", entry_id="c"),  # exactly at the limit: fine
    ]
    errors = rules.check_policy(entries, max_hours_per_day=Decimal("16"), max_hours_per_week=None)
    assert list(errors) == ["day.2026-10-20"]
    assert "17.00" in errors["day.2026-10-20"] and "16.00" in errors["day.2026-10-20"]


def test_weekly_limit_uses_exact_decimal_totals() -> None:
    entries = [entry("2026-10-19", "0.10", entry_id="a"), entry("2026-10-20", "0.20", entry_id="b")]
    assert (
        rules.check_policy(entries, max_hours_per_day=None, max_hours_per_week=Decimal("0.30"))
        == {}
    )
    errors = rules.check_policy(entries, max_hours_per_day=None, max_hours_per_week=Decimal("0.29"))
    assert list(errors) == ["week"]
    assert "0.30" in errors["week"]
