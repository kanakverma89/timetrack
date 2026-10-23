from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.core.errors import ServiceUnavailableError
from app.core.logging import logger
from app.security.dependencies import DbDep

router = APIRouter(prefix="/health", tags=["health"])


@router.get("")
def liveness() -> dict[str, str]:
    """Process is up. Does not touch the database."""
    return {"status": "ok"}


@router.get("/ready")
def readiness(db: DbDep) -> dict[str, str]:
    """Database is reachable."""
    try:
        db.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        logger.error("readiness_check_failed", extra={"error_type": type(exc).__name__})
        raise ServiceUnavailableError("Database is not reachable.") from exc
    return {"status": "ok", "database": "ok"}
