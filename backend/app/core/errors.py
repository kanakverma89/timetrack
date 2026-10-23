"""Application errors and the consistent JSON error envelope (spec §8.1)."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import get_request_id, logger


class AppError(Exception):
    status_code = 400
    code = "BAD_REQUEST"
    message = "The request could not be processed."

    def __init__(
        self,
        message: str | None = None,
        *,
        field_errors: dict[str, str] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message or self.message)
        self.message = message or self.message
        self.field_errors = field_errors or {}
        self.headers = headers


class UnauthenticatedError(AppError):
    status_code = 401
    code = "UNAUTHENTICATED"
    message = "Authentication is required."


class InvalidCredentialsError(AppError):
    status_code = 401
    code = "INVALID_CREDENTIALS"
    message = "Invalid email or password."


class ForbiddenError(AppError):
    status_code = 403
    code = "FORBIDDEN"
    message = "You do not have permission to perform this action."


class NotFoundError(AppError):
    status_code = 404
    code = "NOT_FOUND"
    message = "The requested resource was not found."


class ConflictError(AppError):
    status_code = 409
    code = "CONFLICT"
    message = "The request conflicts with the current state of the resource."


class BusinessRuleError(AppError):
    status_code = 422
    code = "BUSINESS_RULE_VIOLATION"
    message = "The request violates a business rule."


class RateLimitedError(AppError):
    status_code = 429
    code = "RATE_LIMITED"
    message = "Too many attempts. Please try again later."


def error_body(
    code: str, message: str, field_errors: dict[str, str] | None = None
) -> dict[str, Any]:
    return {
        "error": {
            "code": code,
            "message": message,
            "field_errors": field_errors or {},
            "request_id": get_request_id(),
        }
    }


def _field_name(loc: tuple[Any, ...]) -> str:
    parts = [str(p) for p in loc if p not in ("body", "query", "path")]
    return ".".join(parts) or "request"


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=error_body(exc.code, exc.message, exc.field_errors),
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        field_errors: dict[str, str] = {}
        for item in exc.errors():
            field_errors.setdefault(_field_name(tuple(item["loc"])), str(item["msg"]))
        return JSONResponse(
            status_code=422,
            content=error_body(
                "VALIDATION_ERROR", "The request contains invalid fields.", field_errors
            ),
        )

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_exception(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED"}.get(exc.status_code, "HTTP_ERROR")
        message = "The requested resource was not found." if exc.status_code == 404 else "Error."
        if exc.status_code == 405:
            message = "Method not allowed."
        return JSONResponse(
            status_code=exc.status_code,
            content=error_body(code, message),
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(Exception)
    async def handle_unexpected(_: Request, exc: Exception) -> JSONResponse:
        # Log the exception type and traceback server-side; never return details to the client.
        logger.error("unhandled_exception", exc_info=exc)
        return JSONResponse(
            status_code=500,
            content=error_body("INTERNAL_ERROR", "An unexpected error occurred."),
        )


class ValidationFailedError(AppError):
    status_code = 422
    code = "VALIDATION_ERROR"
    message = "The request contains invalid fields."


class ServiceUnavailableError(AppError):
    status_code = 503
    code = "SERVICE_UNAVAILABLE"
    message = "The service is not ready."
