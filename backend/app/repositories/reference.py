from __future__ import annotations

import uuid
from collections.abc import Sequence

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models import EarningCode, Project, ProjectTask


def _escape_like(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def list_projects(
    db: Session, *, active: bool | None, search: str | None, limit: int = 200
) -> Sequence[Project]:
    stmt = select(Project).order_by(Project.code)
    if active is not None:
        stmt = stmt.where(Project.is_active.is_(active))
    if search and search.strip():
        pattern = f"%{_escape_like(search.strip())}%"
        stmt = stmt.where(
            or_(Project.code.ilike(pattern, escape="\\"), Project.name.ilike(pattern, escape="\\"))
        )
    return db.scalars(stmt.limit(limit)).all()


def get_project(db: Session, project_id: uuid.UUID) -> Project | None:
    return db.get(Project, project_id)


def list_tasks(db: Session, project_id: uuid.UUID, *, active: bool | None) -> Sequence[ProjectTask]:
    stmt = (
        select(ProjectTask).where(ProjectTask.project_id == project_id).order_by(ProjectTask.code)
    )
    if active is not None:
        stmt = stmt.where(ProjectTask.is_active.is_(active))
    return db.scalars(stmt).all()


def list_earning_codes(db: Session, *, active: bool | None) -> Sequence[EarningCode]:
    stmt = select(EarningCode).order_by(EarningCode.code)
    if active is not None:
        stmt = stmt.where(EarningCode.is_active.is_(active))
    return db.scalars(stmt).all()
