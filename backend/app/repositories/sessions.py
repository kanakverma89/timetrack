from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import AuthSession, User


def _now() -> datetime:
    return datetime.now(UTC)


def create(db: Session, *, user_id: uuid.UUID, digest: str, expires_at: datetime) -> AuthSession:
    row = AuthSession(user_id=user_id, token_digest=digest, expires_at=expires_at)
    db.add(row)
    db.flush()
    return row


def get_user_for_active_session(db: Session, digest: str) -> User | None:
    stmt = (
        select(User)
        .join(AuthSession, AuthSession.user_id == User.id)
        .where(
            AuthSession.token_digest == digest,
            AuthSession.revoked_at.is_(None),
            AuthSession.expires_at > _now(),
        )
    )
    return db.scalar(stmt)


def revoke(db: Session, digest: str) -> None:
    db.execute(
        update(AuthSession)
        .where(AuthSession.token_digest == digest, AuthSession.revoked_at.is_(None))
        .values(revoked_at=_now())
    )


def revoke_all_for_user(db: Session, user_id: uuid.UUID, *, keep_digest: str | None = None) -> int:
    """Revoke every live session of a user (optionally keeping the one making the request)."""
    stmt = (
        update(AuthSession)
        .where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=_now())
    )
    if keep_digest is not None:
        stmt = stmt.where(AuthSession.token_digest != keep_digest)
    return int(db.execute(stmt).rowcount or 0)  # type: ignore[attr-defined]
