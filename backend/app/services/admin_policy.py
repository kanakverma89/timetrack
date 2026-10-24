"""Administrator-editable hour policy and the audit log reader (Phase 7)."""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import ValidationFailedError
from app.models import (
    ConfigAction,
    ConfigAuditEvent,
    ConfigEntity,
    PolicySetting,
    User,
)
from app.models import (
    ConfigEntity as E,
)
from app.schemas.admin import AuditItem, AuditList, PolicyRead, PolicyWrite
from app.schemas.approval import PersonRef
from app.services import config_audit
from app.services.policy import Policy, effective_policy, from_settings


def _fields(policy: Policy) -> dict[str, object]:
    return {
        "max_hours_per_entry": policy.max_hours_per_entry,
        "max_hours_per_day": policy.max_hours_per_day,
        "max_hours_per_week": policy.max_hours_per_week,
        "description_max_length": policy.description_max_length,
    }


def get_policy(db: Session, settings: Settings) -> PolicyRead:
    policy = effective_policy(db, settings)
    return PolicyRead(
        max_hours_per_entry=policy.max_hours_per_entry,
        max_hours_per_day=policy.max_hours_per_day,
        max_hours_per_week=policy.max_hours_per_week,
        description_max_length=policy.description_max_length,
        source=policy.source,
        updated_at=policy.updated_at,
        updated_by_name=policy.updated_by_name,
        environment_defaults={
            k: (str(v) if isinstance(v, Decimal) else v)
            for k, v in _fields(from_settings(settings)).items()
        },
    )


def update_policy(db: Session, actor: User, settings: Settings, payload: PolicyWrite) -> PolicyRead:
    errors: dict[str, str] = {}
    if (
        payload.max_hours_per_day is not None
        and payload.max_hours_per_week is not None
        and payload.max_hours_per_week < payload.max_hours_per_day
    ):
        errors["max_hours_per_week"] = "The weekly limit cannot be below the daily limit."
    if (
        payload.max_hours_per_day is not None
        and payload.max_hours_per_entry > payload.max_hours_per_day
    ):
        # An entry larger than the whole day's allowance could never be submitted.
        errors["max_hours_per_entry"] = "A single entry cannot exceed the daily limit."
    if errors:
        raise ValidationFailedError(field_errors=errors)

    before = effective_policy(db, settings)
    row = db.get(PolicySetting, 1)
    if row is None:
        row = PolicySetting(id=1, updated_by=actor.id)
        db.add(row)
    # Store exactly what the database will hold (two decimals), so what we return and audit now is
    # what a later read shows.
    two = Decimal("0.01")
    after: dict[str, Any] = {
        "max_hours_per_entry": payload.max_hours_per_entry.quantize(two),
        "max_hours_per_day": payload.max_hours_per_day.quantize(two)
        if payload.max_hours_per_day is not None
        else None,
        "max_hours_per_week": payload.max_hours_per_week.quantize(two)
        if payload.max_hours_per_week is not None
        else None,
        "description_max_length": payload.description_max_length,
    }
    row.max_hours_per_entry = after["max_hours_per_entry"]
    row.max_hours_per_day = after["max_hours_per_day"]
    row.max_hours_per_week = after["max_hours_per_week"]
    row.description_max_length = payload.description_max_length
    row.updated_by = actor.id
    db.flush()
    diff = config_audit.changes(_fields(before), after)
    config_audit.record(
        db,
        actor,
        entity_type=ConfigEntity.POLICY,
        entity_id=None,
        action=ConfigAction.UPDATED,
        label="Hour policy",
        diff=diff,
    )
    db.commit()
    return get_policy(db, settings)


def reset_policy(db: Session, actor: User, settings: Settings) -> PolicyRead:
    """Remove the database override so the environment defaults apply again."""
    row = db.get(PolicySetting, 1)
    if row is not None:
        before = effective_policy(db, settings)
        defaults = from_settings(settings)
        db.delete(row)
        config_audit.record(
            db,
            actor,
            entity_type=ConfigEntity.POLICY,
            entity_id=None,
            action=ConfigAction.DELETED,
            label="Hour policy (back to environment defaults)",
            diff=config_audit.changes(_fields(before), _fields(defaults)),
        )
        db.commit()
    return get_policy(db, settings)


def list_audit(
    db: Session,
    *,
    entity_type: E | None,
    entity_id: uuid.UUID | None,
    page: int,
    page_size: int,
) -> AuditList:
    conditions = []
    if entity_type is not None:
        conditions.append(ConfigAuditEvent.entity_type == entity_type)
    if entity_id is not None:
        conditions.append(ConfigAuditEvent.entity_id == entity_id)
    total = db.scalar(select(func.count()).select_from(ConfigAuditEvent).where(*conditions)) or 0
    rows = db.execute(
        select(ConfigAuditEvent, User)
        .join(User, User.id == ConfigAuditEvent.actor_id)
        .where(*conditions)
        .order_by(ConfigAuditEvent.created_at.desc(), ConfigAuditEvent.id)
        .limit(page_size)
        .offset((page - 1) * page_size)
    ).all()
    # Audit rows about people hold only ids; the names shown are the people's names *now*, so an
    # anonymised person reads "Former employee" everywhere, including in history.
    wanted: set[uuid.UUID] = {
        e.entity_id for e, _ in rows if e.entity_type is E.USER and e.entity_id
    }
    for event, _actor in rows:
        if event.action is ConfigAction.MEMBERS_CHANGED:
            wanted |= set(_member_ids(event.details))
    names = (
        dict(db.execute(select(User.id, User.display_name).where(User.id.in_(wanted))).all())
        if wanted
        else {}
    )
    return AuditList(
        items=[
            AuditItem(
                id=e.id,
                created_at=e.created_at,
                actor=PersonRef.model_validate(u),
                entity_type=e.entity_type,
                entity_id=e.entity_id,
                entity_label=(
                    names.get(e.entity_id) if e.entity_type is E.USER and e.entity_id else None
                )
                or (None if e.entity_type is E.USER else e.details.get("label")),
                action=e.action,
                details=_with_member_names(e, names),
            )
            for e, u in rows
        ],
        page=page,
        page_size=page_size,
        total=int(total),
    )


def _member_ids(details: dict[str, Any]) -> list[uuid.UUID]:
    changes = details.get("changes") or {}
    found: list[uuid.UUID] = []
    for key, side in (("added", "to"), ("removed", "from")):
        for raw in (changes.get(key) or {}).get(side) or []:
            try:
                found.append(uuid.UUID(str(raw)))
            except ValueError:
                continue  # rows written before ids were used hold something else; show it as is
    return found


def _with_member_names(event: ConfigAuditEvent, names: dict[uuid.UUID, str]) -> dict[str, Any]:
    """The stored details with member ids swapped for current names (a copy; the row is kept)."""
    if event.action is not ConfigAction.MEMBERS_CHANGED:
        return event.details

    def name(raw: Any) -> str:
        try:
            return names.get(uuid.UUID(str(raw)), "Unknown person")
        except ValueError:
            return str(raw)

    details = {**event.details}
    changes = {**(details.get("changes") or {})}
    for key, side in (("added", "to"), ("removed", "from")):
        entry = {**(changes.get(key) or {})}
        entry[side] = sorted(name(raw) for raw in entry.get(side) or [])
        changes[key] = entry
    details["changes"] = changes
    return details
