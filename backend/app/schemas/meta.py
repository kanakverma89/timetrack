from __future__ import annotations

from datetime import date
from decimal import Decimal

from pydantic import BaseModel


class MetaRead(BaseModel):
    app_name: str
    business_timezone: str
    week_start_day: str
    today: date
    current_week_start_date: date
    max_hours_per_entry: Decimal
    description_max_length: int
