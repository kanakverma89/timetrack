from __future__ import annotations

from fastapi import APIRouter

from app.schemas.meta import MetaRead
from app.security.dependencies import CurrentUser, SettingsDep
from app.services import weeks

router = APIRouter(tags=["meta"])


@router.get("/meta", response_model=MetaRead)
def get_meta(_: CurrentUser, settings: SettingsDep) -> MetaRead:
    """Business configuration and the server's notion of 'today' (business timezone)."""
    today = weeks.business_today(settings.tzinfo)
    return MetaRead(
        app_name=settings.app_name,
        business_timezone=settings.business_timezone,
        week_start_day=settings.week_start_day.name,
        today=today,
        current_week_start_date=weeks.week_start_for(today, settings.week_start_day),
        max_hours_per_entry=settings.max_hours_per_entry,
        description_max_length=settings.description_max_length,
    )
