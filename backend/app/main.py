from __future__ import annotations

import re
import time
import uuid
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import Settings, get_settings
from app.core.db import get_sessionmaker
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging, logger, set_request_id
from app.core.ratelimit import FailureLimiter
from app.services.notifications import LoggingNotificationAdapter, NotificationPort

_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9-]{8,64}$")

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    "Permissions-Policy": "geolocation=(), camera=(), microphone=(), payment=()",
    "Cross-Origin-Resource-Policy": "same-site",
}
# An API returns data, never a page: nothing it sends should ever be rendered or framed.
API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
HSTS = "max-age=31536000; includeSubDomains"


def create_app(
    settings: Settings | None = None, notification_port: NotificationPort | None = None
) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title=f"{settings.app_name} API",
        version="0.1.0",
        docs_url=f"{settings.api_v1_prefix}/docs" if settings.docs_enabled else None,
        redoc_url=None,
        openapi_url=f"{settings.api_v1_prefix}/openapi.json" if settings.docs_enabled else None,
    )
    app.state.settings = settings
    # Replaceable seams: how background work gets a database session, and where notifications go.
    app.state.session_factory = lambda: get_sessionmaker()()
    app.state.notification_port = notification_port or LoggingNotificationAdapter()
    app.state.login_limiter = FailureLimiter(
        settings.login_max_attempts, settings.login_window_seconds
    )

    register_exception_handlers(app)
    app.include_router(api_router, prefix=settings.api_v1_prefix)

    @app.middleware("http")
    async def request_context(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        incoming = request.headers.get("x-request-id", "")
        request_id = incoming if _REQUEST_ID_RE.match(incoming) else uuid.uuid4().hex
        set_request_id(request_id)
        started = time.perf_counter()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
        finally:
            logger.info(
                "request",
                extra={
                    "method": request.method,
                    "path": request.url.path,  # query string intentionally omitted
                    "status": status,
                    "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                },
            )
        response.headers["X-Request-ID"] = request_id
        for key, value in SECURITY_HEADERS.items():
            response.headers.setdefault(key, value)
        # The interactive docs (development only) need scripts and styles, so they get no CSP.
        if not (
            settings.docs_enabled and request.url.path.startswith(settings.api_v1_prefix + "/docs")
        ):
            response.headers.setdefault("Content-Security-Policy", API_CSP)
        if settings.cookie_secure:  # production: tell browsers to insist on HTTPS from now on
            response.headers.setdefault("Strict-Transport-Security", HSTS)
        return response

    # Added last so it is outermost and also answers preflights.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "X-Requested-With", "X-Request-ID"],
    )
    return app


app = create_app()
