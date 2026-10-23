from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import InvalidCredentialsError
from app.models import User
from app.repositories import sessions as session_repo
from app.repositories import users as user_repo
from app.security.passwords import verify_password
from app.security.tokens import digest_token, new_session_token


def authenticate(db: Session, email: str, password: str) -> User:
    """Return the active user for valid credentials; one generic error otherwise."""
    user = user_repo.get_by_email(db, email)
    password_ok = verify_password(user.password_hash if user else None, password)
    if user is None or not user.is_active or not password_ok:
        raise InvalidCredentialsError()
    return user


def start_session(db: Session, user: User, settings: Settings) -> tuple[str, int]:
    """Create a server-side session. Returns (raw cookie token, max-age seconds)."""
    token = new_session_token()
    ttl = timedelta(hours=settings.session_ttl_hours)
    session_repo.create(
        db,
        user_id=user.id,
        digest=digest_token(token, settings.session_secret),
        expires_at=datetime.now(UTC) + ttl,
    )
    db.commit()
    return token, int(ttl.total_seconds())


def end_session(db: Session, token: str | None, settings: Settings) -> None:
    if token:
        session_repo.revoke(db, digest_token(token, settings.session_secret))
        db.commit()
