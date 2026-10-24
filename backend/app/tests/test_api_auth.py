from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import AuthSession, Role
from app.tests.conftest import TEST_ORIGIN
from app.tests.factories import PASSWORD, login, make_user

API = "/api/v1"


def post_login(
    client: TestClient, email: str = "emp@example.test", password: str = PASSWORD
) -> Any:
    return client.post(f"{API}/auth/login", json={"email": email, "password": password})


def test_login_success_returns_user_and_sets_hardened_cookie(
    client: TestClient, db: Session
) -> None:
    make_user(db)
    response = post_login(client)
    assert response.status_code == 200
    body = response.json()
    assert body["email"] == "emp@example.test"
    assert body["role"] == "EMPLOYEE"
    # No credential material in the response (the boolean flag "must_change_password" is fine).
    assert "password_hash" not in response.text and "argon2" not in response.text
    assert set(body) == {"id", "email", "display_name", "role", "must_change_password"}
    cookie = response.headers["set-cookie"].lower()
    assert "timetrack_session=" in cookie
    assert "httponly" in cookie
    assert "samesite=lax" in cookie
    assert "path=/" in cookie
    assert "secure" not in cookie  # only enabled in production


def test_cookie_is_secure_in_production(make_client: Any, test_url: Any, db: Session) -> None:
    from app.tests.conftest import make_settings

    make_user(db)
    prod = make_settings(
        test_url,
        app_env="production",
        cors_origins=["https://app.example.test"],
        database_url="postgresql+psycopg://u:realpassword@db/app",
    )
    client = make_client(prod)
    response = post_login(client)
    assert response.status_code == 200
    assert "secure" in response.headers["set-cookie"].lower()


def test_session_token_is_not_stored_in_plaintext(client: TestClient, db: Session) -> None:
    make_user(db)
    response = post_login(client)
    token = response.cookies.get("timetrack_session")
    assert token
    stored = [row.token_digest for row in db.query(AuthSession).all()]
    assert len(stored) == 1
    assert token not in stored[0]


def test_me_returns_current_user_after_login(client: TestClient, db: Session) -> None:
    make_user(db, role=Role.MANAGER)
    login(client)
    response = client.get(f"{API}/auth/me")
    assert response.status_code == 200
    assert response.json()["role"] == "MANAGER"


def test_me_requires_authentication(client: TestClient) -> None:
    response = client.get(f"{API}/auth/me")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"


def test_wrong_password_and_unknown_email_are_indistinguishable(
    client: TestClient, db: Session
) -> None:
    make_user(db)
    wrong = post_login(client, password="not-the-password")
    unknown = post_login(client, email="nobody@example.test")
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json()["error"]["code"] == unknown.json()["error"]["code"] == "INVALID_CREDENTIALS"
    assert wrong.json()["error"]["message"] == unknown.json()["error"]["message"]
    assert "set-cookie" not in wrong.headers


def test_inactive_user_cannot_login(client: TestClient, db: Session) -> None:
    make_user(db, active=False)
    assert post_login(client).status_code == 401


def test_user_without_password_cannot_login(client: TestClient, db: Session) -> None:
    make_user(db, password=None)
    assert post_login(client, password="anything").status_code == 401


def test_email_is_case_and_whitespace_insensitive(client: TestClient, db: Session) -> None:
    make_user(db)
    assert post_login(client, email="  EMP@Example.TEST ").status_code == 200


def test_logout_revokes_session_server_side(client: TestClient, db: Session) -> None:
    make_user(db)
    login(client)
    token = client.cookies.get("timetrack_session")
    assert client.post(f"{API}/auth/logout").status_code == 204
    assert client.get(f"{API}/auth/me").status_code == 401
    # Replaying the old cookie value must fail even though the client still knows it.
    client.cookies.set("timetrack_session", token or "")
    assert client.get(f"{API}/auth/me").status_code == 401


def test_logout_without_session_is_ok(client: TestClient) -> None:
    assert client.post(f"{API}/auth/logout").status_code == 204


def test_expired_session_is_rejected(client: TestClient, db: Session) -> None:
    make_user(db)
    login(client)
    db.execute(update(AuthSession).values(expires_at=datetime.now(UTC) - timedelta(seconds=1)))
    db.commit()
    assert client.get(f"{API}/auth/me").status_code == 401


def test_session_dies_when_user_is_deactivated(client: TestClient, db: Session) -> None:
    user = make_user(db)
    login(client)
    user.is_active = False
    db.commit()
    assert client.get(f"{API}/auth/me").status_code == 401


def test_garbage_cookie_is_rejected(client: TestClient) -> None:
    client.cookies.set("timetrack_session", "garbage")
    assert client.get(f"{API}/auth/me").status_code == 401


# --- CSRF -----------------------------------------------------------------------------------


def test_unsafe_request_without_csrf_header_is_forbidden(
    make_client: Any, settings: Settings, db: Session
) -> None:
    make_user(db)
    client = make_client(settings, headers={})
    response = client.post(
        f"{API}/auth/login", json={"email": "emp@example.test", "password": PASSWORD}
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN"
    assert "set-cookie" not in response.headers


def test_disallowed_origin_is_forbidden(client: TestClient, db: Session) -> None:
    make_user(db)
    response = client.post(
        f"{API}/auth/login",
        json={"email": "emp@example.test", "password": PASSWORD},
        headers={"Origin": "https://evil.example"},
    )
    assert response.status_code == 403


def test_allowed_origin_is_accepted(client: TestClient, db: Session) -> None:
    make_user(db)
    response = client.post(
        f"{API}/auth/login",
        json={"email": "emp@example.test", "password": PASSWORD},
        headers={"Origin": TEST_ORIGIN},
    )
    assert response.status_code == 200


def test_cors_allows_configured_origin_with_credentials_and_no_wildcard(client: TestClient) -> None:
    ok = client.options(
        f"{API}/auth/login",
        headers={
            "Origin": TEST_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-requested-with",
        },
    )
    assert ok.headers["access-control-allow-origin"] == TEST_ORIGIN
    assert ok.headers["access-control-allow-credentials"] == "true"
    bad = client.options(
        f"{API}/auth/login",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"},
    )
    assert "access-control-allow-origin" not in bad.headers


# --- throttling -----------------------------------------------------------------------------


def test_login_is_rate_limited_after_repeated_failures(client: TestClient, db: Session) -> None:
    make_user(db)
    for _ in range(5):
        assert post_login(client, password="wrong").status_code == 401
    blocked = post_login(client, password=PASSWORD)  # even the right password is refused
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "RATE_LIMITED"
    assert "retry-after" in blocked.headers
    # A different account is not affected.
    make_user(db, email="other@example.test")
    assert post_login(client, email="other@example.test").status_code == 200


def test_successful_login_resets_failure_count(client: TestClient, db: Session) -> None:
    make_user(db)
    for _ in range(4):
        post_login(client, password="wrong")
    assert post_login(client).status_code == 200
    for _ in range(4):
        assert post_login(client, password="wrong").status_code == 401
