from __future__ import annotations

from datetime import date
from decimal import Decimal

from app.models import Classification, WeekStatus
from app.services import summary, weeks
from app.services.summary import EntryFacts

DATES = weeks.week_dates(date(2026, 10, 19))


def fact(day: str, hours: str, c: Classification = Classification.CAPPED) -> EntryFacts:
    return EntryFacts(date.fromisoformat(day), Decimal(hours), c)


def test_decimal_sum_has_no_floating_point_error() -> None:
    # 0.1 + 0.2 != 0.3 with floats; Decimals must be exact.
    entries = [fact("2026-10-19", "0.10"), fact("2026-10-19", "0.20")]
    result = summary.summarize(entries, WeekStatus.DRAFT)
    assert result.total_hours == Decimal("0.30")
    assert str(result.total_hours) == "0.30"


def test_capped_plus_non_capped_equals_total() -> None:
    entries = [
        fact("2026-10-19", "7.25"),
        fact("2026-10-20", "2.50", Classification.NON_CAPPED),
        fact("2026-10-21", "0.01", Classification.NON_CAPPED),
    ]
    s = summary.summarize(entries, WeekStatus.DRAFT)
    assert s.capped_hours == Decimal("7.25")
    assert s.non_capped_hours == Decimal("2.51")
    assert s.capped_hours + s.non_capped_hours == s.total_hours == Decimal("9.76")
    assert s.entry_count == 3


def test_empty_week_is_all_zero_with_two_decimals() -> None:
    s = summary.summarize([], WeekStatus.DRAFT)
    assert (str(s.total_hours), str(s.capped_hours), str(s.non_capped_hours)) == (
        "0.00",
        "0.00",
        "0.00",
    )
    assert s.entry_count == 0
    assert s.draft_count == 0


def test_draft_count_only_while_editable() -> None:
    entries = [fact("2026-10-19", "1.00"), fact("2026-10-20", "2.00")]
    assert summary.summarize(entries, WeekStatus.DRAFT).draft_count == 2
    assert summary.summarize(entries, WeekStatus.REJECTED).draft_count == 2
    assert summary.summarize(entries, WeekStatus.SUBMITTED).draft_count == 0
    assert summary.summarize(entries, WeekStatus.APPROVED).draft_count == 0


def test_daily_totals_cover_all_seven_days_and_ignore_outside_dates() -> None:
    entries = [
        fact("2026-10-19", "8.00"),
        fact("2026-10-19", "0.50"),
        fact("2026-10-25", "1.25"),
        fact("2026-10-26", "9.00"),  # outside the week: must be ignored
    ]
    totals = summary.daily_totals(entries, DATES)
    assert [d for d, _ in totals] == DATES
    assert [str(h) for _, h in totals] == ["8.50", "0.00", "0.00", "0.00", "0.00", "0.00", "1.25"]
