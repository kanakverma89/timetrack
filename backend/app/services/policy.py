"""The hour/description policy in force.

Defaults come from the environment (``MAX_HOURS_PER_ENTRY`` etc.). An administrator can override all
four values in the database (``policy_settings``, one row); once that row exists it wins. Reading it
on every request is one primary-key lookup, so changes apply immediately and consistently.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Literal

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import PolicySetting, User


@dataclass(frozen=True)
class Policy:
    max_hours_per_entry: Decimal
    max_hours_per_day: Decimal | None
    max_hours_per_week: Decimal | None
    description_max_length: int
    source: Literal["environment", "database"]
    updated_at: datetime | None = None
    updated_by_name: str | None = None


TWO_PLACES = Decimal("0.01")


def _hours(value: Decimal | None) -> Decimal | None:
    """Two decimals, like the database column, so a default and a saved value read the same."""
    return None if value is None else value.quantize(TWO_PLACES)


def from_settings(settings: Settings) -> Policy:
    return Policy(
        max_hours_per_entry=settings.max_hours_per_entry.quantize(TWO_PLACES),
        max_hours_per_day=_hours(settings.max_hours_per_day),
        max_hours_per_week=_hours(settings.max_hours_per_week),
        description_max_length=settings.description_max_length,
        source="environment",
    )


def effective_policy(db: Session, settings: Settings) -> Policy:
    row = db.get(PolicySetting, 1)
    if row is None:
        return from_settings(settings)
    editor = db.get(User, row.updated_by)
    return Policy(
        max_hours_per_entry=row.max_hours_per_entry,
        max_hours_per_day=row.max_hours_per_day,
        max_hours_per_week=row.max_hours_per_week,
        description_max_length=row.description_max_length,
        source="database",
        updated_at=row.updated_at,
        updated_by_name=editor.display_name if editor else None,
    )
