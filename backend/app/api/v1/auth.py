from __future__ import annotations

from fastapi import APIRouter, Request, Response

from app.core.errors import InvalidCredentialsError, RateLimitedError
from app.schemas.auth import LoginRequest, UserRead
from app.security.dependencies import CurrentUser, DbDep, SettingsDep
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


def _client_key(request: Request, email: str) -> str:
    # request.client is the direct peer. X-Forwarded-For is deliberately not trusted here.
    host = request.client.host if request.client else "unknown"
    return f"{host}|{email}"


@router.post("/login", response_model=UserRead)
def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: DbDep,
    settings: SettingsDep,
) -> UserRead:
    limiter = request.app.state.login_limiter
    key = _client_key(request, body.email)
    if limiter.is_blocked(key):
        raise RateLimitedError(headers={"Retry-After": str(settings.login_window_seconds)})
    try:
        user = auth_service.authenticate(db, body.email, body.password)
    except InvalidCredentialsError:
        limiter.record_failure(key)
        raise
    limiter.reset(key)
    token, max_age = auth_service.start_session(db, user, settings)
    response.set_cookie(
        settings.session_cookie_name,
        token,
        max_age=max_age,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )
    return UserRead.model_validate(user)


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: DbDep, settings: SettingsDep) -> None:
    auth_service.end_session(db, request.cookies.get(settings.session_cookie_name), settings)
    response.delete_cookie(
        settings.session_cookie_name,
        path="/",
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
    )


@router.get("/me", response_model=UserRead)
def me(user: CurrentUser) -> UserRead:
    return UserRead.model_validate(user)
