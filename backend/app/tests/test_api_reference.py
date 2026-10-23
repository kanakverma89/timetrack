from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import Classification
from app.tests.factories import login, make_earning, make_project, make_task, make_user

API = "/api/v1"


@pytest.fixture
def authed(client: TestClient, db: Session) -> TestClient:
    make_user(db)
    login(client)
    return client


@pytest.mark.parametrize(
    "path",
    ["/projects", f"/projects/{uuid.uuid4()}/tasks", "/earning-codes", "/meta"],
)
def test_reference_endpoints_require_authentication(client: TestClient, path: str) -> None:
    assert client.get(f"{API}{path}").status_code == 401


def test_projects_default_to_active_only_sorted_by_code(authed: TestClient, db: Session) -> None:
    make_project(db, "B-2")
    make_project(db, "A-1")
    make_project(db, "Z-9", active=False)
    items = authed.get(f"{API}/projects").json()["items"]
    assert [p["code"] for p in items] == ["A-1", "B-2"]
    assert set(items[0]) == {"id", "code", "name", "is_active"}


def test_projects_inactive_filter(authed: TestClient, db: Session) -> None:
    make_project(db, "A-1")
    make_project(db, "Z-9", active=False)
    items = authed.get(f"{API}/projects", params={"active": "false"}).json()["items"]
    assert [p["code"] for p in items] == ["Z-9"]


def test_projects_search_matches_code_or_name_case_insensitively(
    authed: TestClient, db: Session
) -> None:
    make_project(db, "PRJ-001", name="Platform Development")
    make_project(db, "PRJ-002", name="Customer Portal")
    by_name = authed.get(f"{API}/projects", params={"search": "portal"}).json()["items"]
    by_code = authed.get(f"{API}/projects", params={"search": "prj-001"}).json()["items"]
    assert [p["code"] for p in by_name] == ["PRJ-002"]
    assert [p["code"] for p in by_code] == ["PRJ-001"]


def test_projects_search_treats_wildcards_literally(authed: TestClient, db: Session) -> None:
    make_project(db, "PRJ-001")
    assert authed.get(f"{API}/projects", params={"search": "%"}).json()["items"] == []
    assert authed.get(f"{API}/projects", params={"search": "_"}).json()["items"] == []


def test_projects_search_length_is_bounded(authed: TestClient) -> None:
    response = authed.get(f"{API}/projects", params={"search": "x" * 101})
    assert response.status_code == 422


def test_tasks_only_for_requested_project_and_active_by_default(
    authed: TestClient, db: Session
) -> None:
    p1, p2 = make_project(db, "P1"), make_project(db, "P2")
    make_task(db, p1, "A")
    make_task(db, p1, "B", active=False)
    make_task(db, p2, "C")
    active = authed.get(f"{API}/projects/{p1.id}/tasks").json()["items"]
    everything = authed.get(f"{API}/projects/{p1.id}/tasks", params={"active": "false"}).json()[
        "items"
    ]
    assert [t["code"] for t in active] == ["A"]
    assert [t["code"] for t in everything] == ["B"]
    assert all(t["project_id"] == str(p1.id) for t in active + everything)


def test_tasks_for_project_without_tasks_is_empty_list(authed: TestClient, db: Session) -> None:
    project = make_project(db, "P1")
    response = authed.get(f"{API}/projects/{project.id}/tasks")
    assert response.status_code == 200
    assert response.json() == {"items": []}


def test_tasks_for_unknown_project_is_404(authed: TestClient) -> None:
    response = authed.get(f"{API}/projects/{uuid.uuid4()}/tasks")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_tasks_with_malformed_project_id_is_422(authed: TestClient) -> None:
    assert authed.get(f"{API}/projects/not-a-uuid/tasks").status_code == 422


def test_earning_codes_include_classification_and_hide_inactive(
    authed: TestClient, db: Session
) -> None:
    make_earning(db, "REG", Classification.CAPPED)
    make_earning(db, "OVT", Classification.NON_CAPPED)
    make_earning(db, "OLD", Classification.CAPPED, active=False)
    items = authed.get(f"{API}/earning-codes").json()["items"]
    assert [(e["code"], e["classification"]) for e in items] == [
        ("OVT", "NON_CAPPED"),
        ("REG", "CAPPED"),
    ]


def test_meta_exposes_server_side_business_date(authed: TestClient) -> None:
    body = authed.get(f"{API}/meta").json()
    assert body["business_timezone"] == "Asia/Kolkata"
    assert body["week_start_day"] == "MONDAY"
    assert body["description_max_length"] == 256
    from datetime import date

    today = date.fromisoformat(body["today"])
    start = date.fromisoformat(body["current_week_start_date"])
    assert start.weekday() == 0
    assert 0 <= (today - start).days <= 6
