"""Pure, decimal-safe aggregation of time entries into daily totals and a weekly summary."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from app.models import Classification, WeekStatus

TWO_PLACES = Decimal("0.01")
ZERO = Decimal("0.00")
EDITABLE_STATUSES = frozenset({WeekStatus.DRAFT, WeekStatus.REJECTED})


@dataclass(frozen=True)
class EntryFacts:
    work_date: date
    hours: Decimal
    classification: Classification


@dataclass(frozen=True)
class Summary:
    total_hours: Decimal
    capped_hours: Decimal
    non_capped_hours: Decimal
    entry_count: int
    draft_count: int


def _q(value: Decimal) -> Decimal:
    return value.quantize(TWO_PLACES)


def daily_totals(
    entries: Iterable[EntryFacts], dates: Sequence[date]
) -> list[tuple[date, Decimal]]:
    totals = {d: ZERO for d in dates}
    for entry in entries:
        if entry.work_date in totals:
            totals[entry.work_date] += entry.hours
    return [(d, _q(totals[d])) for d in dates]


def summarize(entries: Sequence[EntryFacts], status: WeekStatus) -> Summary:
    capped = sum((e.hours for e in entries if e.classification is Classification.CAPPED), ZERO)
    non_capped = sum(
        (e.hours for e in entries if e.classification is Classification.NON_CAPPED), ZERO
    )
    return Summary(
        total_hours=_q(capped + non_capped),
        capped_hours=_q(capped),
        non_capped_hours=_q(non_capped),
        entry_count=len(entries),
        draft_count=len(entries) if status in EDITABLE_STATUSES else 0,
    )
