"""Helpers shared by the time-entry API tests."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import EarningCode, Project, ProjectTask, User

API = "/api/v1"


@dataclass
class World:
    user: User
    project: Project  # has one active task
    task: ProjectTask
    plain_project: Project  # no tasks
    earning: EarningCode
    overtime: EarningCode


def payload(w: World, **overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "work_date": "2026-10-21",
        "hours": "8.00",
        "earning_code_id": str(w.earning.id),
        "project_id": str(w.project.id),
        "task_id": str(w.task.id),
        "description": "Implementation work",
    }
    body.update(overrides)
    return body


def count(db: Session, model: type) -> int:
    db.expire_all()
    return db.scalar(select(func.count()).select_from(model)) or 0


def week_view(client: TestClient, day: str = "2026-10-19") -> dict[str, Any]:
    response = client.get(f"{API}/timesheets/weeks/{day}")
    assert response.status_code == 200
    return response.json()  # type: ignore[no-any-return]
