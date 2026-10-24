"""Housekeeping that keeps the database small and honours the retention policy.

Everything here is a plain function over a session so it can be tested against a real database and
called from ``scripts/maintain.py``. Nothing here touches the append-only audit tables: they are the
record of what happened and are kept (see docs/operations.md for the retention reasoning).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import ColumnElement, delete, func, select
from sqlalchemy.orm import Session

from app.models import (
    AuthSession,
    IdempotencyKey,
    NotificationOutbox,
    OutboxStatus,
    Role,
    User,
)
from app.security.password_policy import check_password
from app.security.passwords import hash_password

ANONYMISED_NAME = "Former employee"
ANONYMISED_DOMAIN = "anonymised.invalid"


class MaintenanceError(Exception):
    """A refused operation; the message is safe to print."""


@dataclass(frozen=True)
class PurgeResult:
    sessions: int
    idempotency_keys: int
    outbox: int

    @property
    def total(self) -> int:
        return self.sessions + self.idempotency_keys + self.outbox


def _count_or_delete(
    db: Session, model: Any, where: list[ColumnElement[bool]], *, dry_run: bool
) -> int:
    if dry_run:
        return int(db.scalar(select(func.count()).select_from(model).where(*where)) or 0)
    result = db.execute(delete(model).where(*where))
    return int(result.rowcount or 0)  # type: ignore[attr-defined]


def purge(
    db: Session,
    *,
    session_days: int = 30,
    idempotency_days: int = 30,
    outbox_days: int = 30,
    dry_run: bool = False,
    now: datetime | None = None,
) -> PurgeResult:
    """Delete rows that have outlived their purpose.

    - sessions that expired (or were revoked) more than ``session_days`` ago;
    - idempotency keys older than ``idempotency_days`` (a retry that late is a new request);
    - outbox rows already SENT more than ``outbox_days`` ago. Rows that are PENDING, PROCESSING or
      FAILED are never touched: they still represent work or evidence of a problem.
    """
    for name, value in (
        ("session_days", session_days),
        ("idempotency_days", idempotency_days),
        ("outbox_days", outbox_days),
    ):
        if value < 1:
            raise MaintenanceError(f"{name} must be at least 1 day.")
    now = now or datetime.now(UTC)

    def before(days: int) -> datetime:
        return now - timedelta(days=days)

    sessions = _count_or_delete(
        db,
        AuthSession,
        [
            (AuthSession.expires_at < before(session_days))
            | (
                AuthSession.revoked_at.is_not(None)
                & (AuthSession.revoked_at < before(session_days))
            )
        ],
        dry_run=dry_run,
    )
    keys = _count_or_delete(
        db, IdempotencyKey, [IdempotencyKey.created_at < before(idempotency_days)], dry_run=dry_run
    )
    outbox = _count_or_delete(
        db,
        NotificationOutbox,
        [
            NotificationOutbox.status == OutboxStatus.SENT,
            NotificationOutbox.processed_at < before(outbox_days),
        ],
        dry_run=dry_run,
    )
    if dry_run:
        db.rollback()
    else:
        db.commit()
    return PurgeResult(sessions=sessions, idempotency_keys=keys, outbox=outbox)


def anonymise_user(db: Session, user_id: uuid.UUID) -> User:
    """Remove a former person's identity while keeping the hours and decisions they appear in.

    Only a deactivated user can be anonymised (so nobody can lose an account by mistake), and only
    one with no active reports. Name and email are replaced, the password is removed and every
    session is revoked. Time entries, weeks and audit rows reference the user by id and are kept.
    This is irreversible.
    """
    user = db.scalar(select(User).where(User.id == user_id).with_for_update())
    if user is None:
        raise MaintenanceError("No such user.")
    if user.is_active:
        raise MaintenanceError("Deactivate the user first; only former users can be anonymised.")
    if user.email.endswith("@" + ANONYMISED_DOMAIN):
        raise MaintenanceError("This user is already anonymised.")
    still_managed = db.scalar(
        select(func.count()).select_from(User).where(User.manager_id == user.id, User.is_active)
    )
    if still_managed:
        raise MaintenanceError("This user still has active reports; reassign them first.")

    user.email = f"user-{user.id}@{ANONYMISED_DOMAIN}"
    user.display_name = ANONYMISED_NAME
    user.password_hash = None
    user.must_change_password = False
    db.execute(
        delete(AuthSession).where(AuthSession.user_id == user.id)
    )  # sessions carry no history worth keeping
    db.commit()
    return user


def create_admin(db: Session, *, email: str, display_name: str, password: str) -> User:
    """Create the first administrator (or an additional one) from the command line.

    The password is chosen by the operator, must satisfy the normal policy and is marked
    must-change so it does not outlive the first sign-in.
    """
    email = email.strip().lower()
    if "@" not in email or " " in email or len(email) > 320:
        raise MaintenanceError("That does not look like an email address.")
    display_name = display_name.strip()
    if not display_name:
        raise MaintenanceError("A display name is required.")
    problem = check_password(password, email=email, display_name=display_name)
    if problem:
        raise MaintenanceError(f"Password rejected: {problem}")
    if db.scalar(select(User.id).where(User.email == email)):
        raise MaintenanceError("A user with this email already exists.")
    user = User(
        email=email,
        display_name=display_name,
        role=Role.ADMIN,
        is_active=True,
        password_hash=hash_password(password),
        must_change_password=True,
    )
    db.add(user)
    db.commit()
    return user
