from __future__ import annotations

from collections.abc import Callable
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.db import get_db
from app.core.errors import ForbiddenError, PasswordChangeRequiredError, UnauthenticatedError
from app.models import Role, User
from app.repositories import sessions as session_repo
from app.security.tokens import digest_token

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
CSRF_HEADER = "x-requested-with"
CSRF_VALUE = "timetrack"
# Everything else is refused until a temporary password has been replaced.
PASSWORD_CHANGE_ALLOWED = frozenset({"/auth/me", "/auth/change-password", "/auth/logout"})


def get_app_settings(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


SettingsDep = Annotated[Settings, Depends(get_app_settings)]
DbDep = Annotated[Session, Depends(get_db)]


def csrf_guard(request: Request, settings: SettingsDep) -> None:
    """Reject cross-site state changes: custom header required, Origin must be allowed."""
    if request.method not in UNSAFE_METHODS:
        return
    if request.headers.get(CSRF_HEADER) != CSRF_VALUE:
        raise ForbiddenError("Missing or invalid CSRF header.")
    origin = request.headers.get("origin")
    if origin:
        parts = urlsplit(origin)
        normalized = f"{parts.scheme}://{parts.netloc}"
        if normalized not in settings.cors_origins:
            raise ForbiddenError("Origin not allowed.")


def get_current_user(request: Request, db: DbDep, settings: SettingsDep) -> User:
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        raise UnauthenticatedError()
    digest = digest_token(token, settings.session_secret)
    user = session_repo.get_user_for_active_session(db, digest)
    if user is None or not user.is_active:
        raise UnauthenticatedError()
    if user.must_change_password:
        path = request.url.path.removeprefix(settings.api_v1_prefix)
        if path not in PASSWORD_CHANGE_ALLOWED:
            raise PasswordChangeRequiredError()
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_roles(*roles: Role) -> Callable[[User], User]:
    """Dependency factory for role-restricted routes (manager/admin milestones)."""

    def checker(user: CurrentUser) -> User:
        if user.role not in roles:
            raise ForbiddenError()
        return user

    return checker
