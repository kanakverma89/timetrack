"""Security regression suite: the authorization matrix, CSRF everywhere, headers, production mode.

The matrix below is the source of truth for "who may call what". The test fails when a route exists
that is not listed here, so a new endpoint cannot ship without someone deciding its access rule.
"""

from __future__ import annotations

import re
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.models import Role
from app.tests.conftest import TEST_ORIGIN, make_settings
from app.tests.factories import login, make_user
from app.tests.support import API

ANON, EMP, MGR, ADM = "anonymous", "employee", "manager", "admin"
EVERYONE = {ANON, EMP, MGR, ADM}
SESSION = {EMP, MGR, ADM}
REVIEWERS = {MGR, ADM}
ADMIN_ONLY = {ADM}

# (method, path template without the /api/v1 prefix) -> roles that get past authorization.
MATRIX: dict[tuple[str, str], set[str]] = {
    # public
    ("GET", "/health"): EVERYONE,
    ("GET", "/health/ready"): EVERYONE,
    ("POST", "/auth/login"): EVERYONE,
    ("POST", "/auth/logout"): EVERYONE,
    # any signed-in person
    ("GET", "/auth/me"): SESSION,
    ("POST", "/auth/change-password"): SESSION,
    ("GET", "/meta"): SESSION,
    ("GET", "/projects"): SESSION,
    ("GET", "/projects/{project_id}/tasks"): SESSION,
    ("GET", "/earning-codes"): SESSION,
    ("GET", "/timesheets/weeks/{week_start_date}"): SESSION,
    ("POST", "/timesheets/weeks/{week_start_date}/submit"): SESSION,
    ("POST", "/time-entries"): SESSION,
    ("POST", "/time-entries/batch"): SESSION,
    ("PATCH", "/time-entries/{entry_id}"): SESSION,
    ("DELETE", "/time-entries/{entry_id}"): SESSION,
    # managers and administrators
    ("GET", "/approvals"): REVIEWERS,
    ("GET", "/approvals/{week_id}"): REVIEWERS,
    ("POST", "/approvals/{week_id}/approve"): REVIEWERS,
    ("POST", "/approvals/{week_id}/reject"): REVIEWERS,
    ("GET", "/reports/hours"): REVIEWERS,
    ("GET", "/reports/hours.csv"): REVIEWERS,
    # administrators only
    ("GET", "/admin/users"): ADMIN_ONLY,
    ("POST", "/admin/users"): ADMIN_ONLY,
    ("GET", "/admin/users/{user_id}"): ADMIN_ONLY,
    ("PATCH", "/admin/users/{user_id}"): ADMIN_ONLY,
    ("POST", "/admin/users/{user_id}/reset-password"): ADMIN_ONLY,
    ("GET", "/admin/teams"): ADMIN_ONLY,
    ("POST", "/admin/teams"): ADMIN_ONLY,
    ("GET", "/admin/teams/{team_id}"): ADMIN_ONLY,
    ("PATCH", "/admin/teams/{team_id}"): ADMIN_ONLY,
    ("PUT", "/admin/teams/{team_id}/members"): ADMIN_ONLY,
    ("DELETE", "/admin/teams/{team_id}"): ADMIN_ONLY,
    ("GET", "/admin/projects"): ADMIN_ONLY,
    ("POST", "/admin/projects"): ADMIN_ONLY,
    ("GET", "/admin/projects/{project_id}"): ADMIN_ONLY,
    ("PATCH", "/admin/projects/{project_id}"): ADMIN_ONLY,
    ("GET", "/admin/projects/{project_id}/tasks"): ADMIN_ONLY,
    ("POST", "/admin/projects/{project_id}/tasks"): ADMIN_ONLY,
    ("PATCH", "/admin/tasks/{task_id}"): ADMIN_ONLY,
    ("GET", "/admin/earning-codes"): ADMIN_ONLY,
    ("POST", "/admin/earning-codes"): ADMIN_ONLY,
    ("PATCH", "/admin/earning-codes/{code_id}"): ADMIN_ONLY,
    ("GET", "/admin/policy"): ADMIN_ONLY,
    ("PUT", "/admin/policy"): ADMIN_ONLY,
    ("DELETE", "/admin/policy"): ADMIN_ONLY,
    ("GET", "/admin/audit"): ADMIN_ONLY,
}

UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}
NIL = "00000000-0000-4000-8000-000000000000"


def routes(app: Any) -> list[tuple[str, str]]:
    prefix = "/api/v1"
    found = []
    for path, operations in app.openapi()["paths"].items():
        for method in operations:
            found.append((method.upper(), path.removeprefix(prefix)))
    return sorted(found)


def fill(template: str) -> str:
    def value(match: re.Match[str]) -> str:
        return "2026-10-19" if match.group(1) == "week_start_date" else NIL

    return re.sub(r"\{(\w+)\}", value, template)


@pytest.fixture
def app_under_test(settings: Any) -> Any:
    return create_app(settings)


@pytest.fixture
def people(db: Any, login_as: Any) -> dict[str, TestClient]:
    make_user(db, "sec-emp@example.test", Role.EMPLOYEE)
    make_user(db, "sec-mgr@example.test", Role.MANAGER)
    make_user(db, "sec-adm@example.test", Role.ADMIN)
    return {
        EMP: login_as("sec-emp@example.test"),
        MGR: login_as("sec-mgr@example.test"),
        ADM: login_as("sec-adm@example.test"),
    }


def test_every_route_is_classified_and_no_classification_is_stale(app_under_test: Any) -> None:
    actual = set(routes(app_under_test))
    assert actual - set(MATRIX) == set(), "new route(s) without an access rule: add them to MATRIX"
    assert set(MATRIX) - actual == set(), "MATRIX lists route(s) that no longer exist"


def test_the_authorization_matrix_holds_for_every_route_and_every_role(
    app_under_test: Any, people: dict[str, TestClient], client: TestClient
) -> None:
    clients = {ANON: client, **people}
    problems: list[str] = []
    for method, template in routes(app_under_test):
        for role, who in clients.items():
            if (method, template) == ("POST", "/auth/logout") and role != ANON:
                continue  # signing out would end the session the other checks reuse
            response = who.request(method, f"{API}{fill(template)}", json={})
            denied = response.status_code in (401, 403)
            should_pass = role in MATRIX[(method, template)]
            if denied == should_pass:
                problems.append(
                    f"{role:<9} {method:<6} {template}: got {response.status_code}, "
                    f"expected {'access' if should_pass else 'denial'}"
                )
            if not should_pass and role != ANON:
                assert response.json()["error"]["code"] == "FORBIDDEN", (role, method, template)
            if not should_pass and role == ANON:
                assert response.status_code == 401, (method, template, response.status_code)
    assert problems == []


def test_a_signed_out_visitor_learns_nothing_about_which_ids_exist(
    app_under_test: Any, client: TestClient
) -> None:
    """Protected routes answer identically (401) whatever id is asked for, real or not."""
    codes = set()
    for method, template in routes(app_under_test):
        if MATRIX[(method, template)] == EVERYONE:
            continue
        for ident in (NIL, str(uuid.uuid4())):
            path = re.sub(r"\{(?!week_start_date)\w+\}", ident, template)
            response = client.request(method, f"{API}{path}", json={})
            assert response.status_code == 401, (method, path, response.status_code)
            codes.add(response.json()["error"]["code"])
    assert codes == {"UNAUTHENTICATED"}


# -------------------------------------------------------------------------------- CSRF


@pytest.mark.parametrize("method_template", sorted(k for k in MATRIX if k[0] in UNSAFE))
def test_every_state_changing_route_refuses_requests_without_the_csrf_header(
    make_client: Any, settings: Any, method_template: tuple[str, str]
) -> None:
    method, template = method_template
    bare = make_client(settings, headers={})
    response = bare.request(method, f"{API}{fill(template)}", json={})
    assert response.status_code == 403, response.text
    assert response.json()["error"]["code"] == "FORBIDDEN"
    assert "set-cookie" not in response.headers


@pytest.mark.parametrize("method_template", sorted(k for k in MATRIX if k[0] in UNSAFE))
def test_every_state_changing_route_refuses_a_foreign_origin_even_with_the_header(
    client: TestClient, method_template: tuple[str, str]
) -> None:
    method, template = method_template
    response = client.request(
        method, f"{API}{fill(template)}", json={}, headers={"Origin": "https://evil.example"}
    )
    assert response.status_code == 403
    allowed = client.request(
        method, f"{API}{fill(template)}", json={}, headers={"Origin": TEST_ORIGIN}
    )
    # With the right origin the CSRF guard lets the request through to authentication/validation.
    assert allowed.status_code != 403, allowed.text


def test_read_only_routes_do_not_require_the_csrf_header(
    make_client: Any, settings: Any, db: Any
) -> None:
    make_user(db, "reader@example.test")
    signed_in = make_client(settings)
    login(signed_in, "reader@example.test")
    # GET has no side effects, so the cookie alone is enough; the header is for state changes.
    bare = make_client(settings, headers={})
    bare.cookies.update(signed_in.cookies)
    assert bare.get(f"{API}/health").status_code == 200
    assert bare.get(f"{API}/auth/me").status_code == 200


# ------------------------------------------------------------------------------- headers


@pytest.mark.parametrize("path", ["/health", "/auth/me", "/nope", "/projects"])
def test_every_response_carries_the_hardening_headers(client: TestClient, path: str) -> None:
    headers = client.get(f"{API}{path}").headers
    assert headers["x-content-type-options"] == "nosniff"
    assert headers["x-frame-options"] == "DENY"
    assert headers["referrer-policy"] == "no-referrer"
    assert headers["cache-control"] == "no-store"
    assert "frame-ancestors 'none'" in headers["content-security-policy"]
    assert "default-src 'none'" in headers["content-security-policy"]
    assert "geolocation=()" in headers["permissions-policy"]
    assert "strict-transport-security" not in headers  # only when served over HTTPS (production)


def test_production_mode_is_https_only_and_exposes_no_docs(
    make_client: Any, test_url: Any, db: Any
) -> None:
    make_user(db, "p@example.test")
    prod = make_client(
        make_settings(
            test_url,
            app_env="production",
            cors_origins=["https://app.example.test"],
            database_url="postgresql+psycopg://u:realpassword@db/app",
        )
    )
    assert prod.get(f"{API}/docs").status_code == 404
    assert prod.get(f"{API}/openapi.json").status_code == 404
    login_response = prod.post(
        f"{API}/auth/login",
        json={"email": "p@example.test", "password": "correct-horse-battery-staple"},
    )
    cookie = login_response.headers["set-cookie"].lower()
    assert "secure" in cookie and "httponly" in cookie and "samesite=lax" in cookie
    assert login_response.headers["strict-transport-security"].startswith("max-age=31536000")


def test_development_docs_keep_working_but_api_responses_keep_their_csp(client: TestClient) -> None:
    docs = client.get(f"{API}/docs")
    assert docs.status_code == 200
    assert "content-security-policy" not in docs.headers  # Swagger UI needs scripts; dev only
    assert "content-security-policy" in client.get(f"{API}/health").headers


def test_error_responses_never_leak_internals(client: TestClient) -> None:
    for path in ("/nope", "/timesheets/weeks/not-a-date", "/projects/not-a-uuid/tasks"):
        text = client.get(f"{API}{path}").text
        for leak in ("Traceback", "sqlalchemy", "psycopg", "/Users/", 'File "', "postgresql://"):
            assert leak not in text, (path, leak)


def test_cors_never_reflects_arbitrary_origins_or_allows_wildcards(client: TestClient) -> None:
    for origin in ("https://evil.example", "null", "http://localhost:5173.evil.example"):
        response = client.options(
            f"{API}/auth/me", headers={"Origin": origin, "Access-Control-Request-Method": "GET"}
        )
        assert "access-control-allow-origin" not in response.headers, origin
    good = client.options(
        f"{API}/auth/me", headers={"Origin": TEST_ORIGIN, "Access-Control-Request-Method": "GET"}
    )
    assert good.headers["access-control-allow-origin"] == TEST_ORIGIN
    assert good.headers["access-control-allow-origin"] != "*"
