"""Notification abstraction (spec §6.1, §7.10).

Business code never talks to a delivery provider. It writes a row to ``notification_outbox`` in the
same transaction as the change that caused it; ``process_pending`` later hands rows to a
``NotificationPort``. Delivery therefore never blocks, or fails, the API response. Real providers
(email, chat) are added by implementing the port.

Payloads carry identifiers and totals only: never descriptions, comments or credentials.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.logging import logger
from app.models import NotificationOutbox, OutboxStatus

MAX_ERROR_LENGTH = 200


class NotificationPort(Protocol):
    def send(self, event_type: str, payload: Mapping[str, object]) -> None:
        """Deliver one notification. Raise on failure; the caller records it and retries."""


class LoggingNotificationAdapter:
    """Development adapter: writes a safe, structured log line instead of sending anything."""

    def send(self, event_type: str, payload: Mapping[str, object]) -> None:
        logger.info(
            "notification_dispatched",
            extra={
                "event_type": event_type,
                "aggregate_id": str(payload.get("week_id", "")),
                "payload_keys": sorted(payload),
            },
        )


def enqueue(
    db: Session, *, event_type: str, aggregate_id: uuid.UUID, payload: dict[str, object]
) -> NotificationOutbox:
    """Add an outbox row to the caller's transaction (no commit)."""
    row = NotificationOutbox(
        event_type=event_type,
        aggregate_id=aggregate_id,
        payload=payload,
        status=OutboxStatus.PENDING,
    )
    db.add(row)
    db.flush()
    return row


def process_pending(
    session_factory: Callable[[], Session],
    port: NotificationPort,
    *,
    max_attempts: int,
    limit: int = 20,
) -> int:
    """Deliver pending outbox rows. Returns how many were sent.

    Each row is claimed with ``FOR UPDATE SKIP LOCKED`` so concurrent workers never double-send. A
    failure increments ``attempt_count`` and records the error type and a short message; the row
    returns to ``PENDING`` until ``max_attempts`` is reached, then becomes ``FAILED``.
    """
    sent = 0
    with session_factory() as db:
        rows = db.scalars(
            select(NotificationOutbox)
            .where(NotificationOutbox.status == OutboxStatus.PENDING)
            .order_by(NotificationOutbox.created_at)
            .limit(limit)
            .with_for_update(skip_locked=True)
        ).all()
        for row in rows:
            row.status = OutboxStatus.PROCESSING
            row.attempt_count += 1
            try:
                port.send(row.event_type, row.payload)
            except Exception as exc:  # noqa: BLE001 - any provider failure is recorded, not raised
                row.last_error = f"{type(exc).__name__}: {str(exc)[:MAX_ERROR_LENGTH]}"
                row.status = (
                    OutboxStatus.FAILED
                    if row.attempt_count >= max_attempts
                    else OutboxStatus.PENDING
                )
                logger.warning(
                    "notification_failed",
                    extra={"outbox_id": str(row.id), "attempt": row.attempt_count},
                )
            else:
                row.status = OutboxStatus.SENT
                row.processed_at = datetime.now(UTC)
                row.last_error = None
                sent += 1
            db.commit()
    return sent
