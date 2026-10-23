from __future__ import annotations

import uuid

from fastapi import APIRouter, Query

from app.core.errors import NotFoundError
from app.repositories import reference as repo
from app.schemas.reference import (
    EarningCodeList,
    EarningCodeRead,
    ProjectList,
    ProjectRead,
    TaskList,
    TaskRead,
)
from app.security.dependencies import CurrentUser, DbDep

router = APIRouter(tags=["reference"])


@router.get("/projects", response_model=ProjectList)
def list_projects(
    _: CurrentUser,
    db: DbDep,
    active: bool | None = True,
    search: str | None = Query(default=None, max_length=100),
) -> ProjectList:
    rows = repo.list_projects(db, active=active, search=search)
    return ProjectList(items=[ProjectRead.model_validate(r) for r in rows])


@router.get("/projects/{project_id}/tasks", response_model=TaskList)
def list_project_tasks(
    project_id: uuid.UUID, _: CurrentUser, db: DbDep, active: bool | None = True
) -> TaskList:
    if repo.get_project(db, project_id) is None:
        raise NotFoundError("Project not found.")
    rows = repo.list_tasks(db, project_id, active=active)
    return TaskList(items=[TaskRead.model_validate(r) for r in rows])


@router.get("/earning-codes", response_model=EarningCodeList)
def list_earning_codes(_: CurrentUser, db: DbDep, active: bool | None = True) -> EarningCodeList:
    rows = repo.list_earning_codes(db, active=active)
    return EarningCodeList(items=[EarningCodeRead.model_validate(r) for r in rows])
