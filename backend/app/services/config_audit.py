"""Audit trail for administrator changes (spec §11.4, Phase 7 "auditable").

Every admin write adds one ``config_audit_events`` row in the same transaction as the change, so a
change cannot exist without its record. Details never contain secrets: no passwords, hashes or
tokens, only labels and ``{field: {from, to}}`` pairs.
"""

from __future__ import annotations

import enum
import uuid
from collections.abc import Mapping
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.models import ConfigAction, ConfigAuditEvent, ConfigEntity, User


def _plain(value: Any) -> Any:
    """JSON-safe form of a value."""
    if isinstance(value, enum.Enum):
        return value.value
    if isinstance(value, uuid.UUID | Decimal):
        return str(value)
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, list | tuple | set):
        return [_plain(v) for v in value]
    return value


def changes(before: Mapping[str, Any], after: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    """The fields whose value differs, as ``{field: {"from": …, "to": …}}``."""
    return {
        key: {"from": _plain(before.get(key)), "to": _plain(after[key])}
        for key in after
        if _plain(before.get(key)) != _plain(after[key])
    }


def record(
    db: Session,
    actor: User,
    *,
    entity_type: ConfigEntity,
    entity_id: uuid.UUID | None,
    action: ConfigAction,
    label: str,
    diff: Mapping[str, Any] | None = None,
) -> None:
    """Add the audit row to the caller's transaction (no commit)."""
    details: dict[str, Any] = {"label": label}
    if diff:
        details["changes"] = _plain(dict(diff))
    db.add(
        ConfigAuditEvent(
            actor_id=actor.id,
            entity_type=entity_type,
            entity_id=entity_id,
            action=action,
            details=details,
        )
    )
