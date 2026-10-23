from __future__ import annotations

from collections.abc import Iterator
from typing import Any
from unittest.mock import MagicMock

from fastapi import APIRouter
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.core.config import Settings
from app.core.db import get_db
from app.main import create_app

API = "/api/v1"


def test_liveness(client: TestClient) -> None:
    response = client.get(f"{API}/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_readiness_checks_database(client: TestClient) -> None:
    response = client.get(f"{API}/health/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}


def test_readiness_returns_503_envelope_when_database_is_down(settings: Settings) -> None:
    app = create_app(settings)

    def broken_db() -> Iterator[MagicMock]:
        session = MagicMock()
        session.execute.side_effect = OperationalError(
            "SELECT 1", {}, Exception("boom: secret-host")
        )
        yield session

    app.dependency_overrides[get_db] = broken_db
    response = TestClient(app).get(f"{API}/health/ready")
    assert response.status_code == 503
    body = response.json()["error"]
    assert body["code"] == "SERVICE_UNAVAILABLE"
    assert "secret-host" not in response.text


def test_unknown_route_uses_error_envelope(client: TestClient) -> None:
    response = client.get(f"{API}/nope")
    assert response.status_code == 404
    error = response.json()["error"]
    assert error["code"] == "NOT_FOUND"
    assert set(error) == {"code", "message", "field_errors", "request_id"}


def test_method_not_allowed_uses_error_envelope(client: TestClient) -> None:
    response = client.delete(f"{API}/health")
    assert response.status_code == 405
    assert response.json()["error"]["code"] == "METHOD_NOT_ALLOWED"


def test_validation_error_has_field_errors(client: TestClient) -> None:
    response = client.post(f"{API}/auth/login", json={"email": "a@example.test"})
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert "password" in error["field_errors"]


def test_request_id_is_generated_and_echoed_when_valid(client: TestClient) -> None:
    generated = client.get(f"{API}/health")
    assert len(generated.headers["x-request-id"]) >= 8

    echoed = client.get(f"{API}/health", headers={"X-Request-ID": "trace-1234-abcd"})
    assert echoed.headers["x-request-id"] == "trace-1234-abcd"

    sanitized = client.get(f"{API}/health", headers={"X-Request-ID": "bad id\r\nX-Evil: 1"})
    assert sanitized.headers["x-request-id"] != "bad id"
    assert "x-evil" not in sanitized.headers


def test_error_body_request_id_matches_header(client: TestClient) -> None:
    response = client.get(f"{API}/auth/me")
    assert response.json()["error"]["request_id"] == response.headers["x-request-id"]


def test_security_headers_present(client: TestClient) -> None:
    headers = client.get(f"{API}/health").headers
    assert headers["x-content-type-options"] == "nosniff"
    assert headers["x-frame-options"] == "DENY"
    assert headers["cache-control"] == "no-store"


def test_unhandled_exception_returns_generic_500(settings: Settings) -> None:
    app = create_app(settings)
    router = APIRouter()

    @router.get("/boom")
    def boom() -> Any:
        raise RuntimeError("internal detail: password=hunter2")

    app.include_router(router)
    response = TestClient(app, raise_server_exceptions=False).get("/boom")
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "INTERNAL_ERROR"
    assert "hunter2" not in response.text
    assert "Traceback" not in response.text


def test_docs_disabled_when_configured(settings: Settings) -> None:
    app = create_app(settings.model_copy(update={"enable_docs": False}))
    assert TestClient(app).get(f"{API}/docs").status_code == 404
    assert TestClient(app).get(f"{API}/openapi.json").status_code == 404
