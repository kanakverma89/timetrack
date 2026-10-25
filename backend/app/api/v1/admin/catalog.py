from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Query

from app.schemas.admin import (
    AdminEarningCodeList,
    AdminEarningCodeRead,
    AdminProjectList,
    AdminProjectRead,
    AdminTaskList,
    AdminTaskRead,
    EarningCodeCreate,
    EarningCodeUpdate,
    ProjectCreate,
    ProjectUpdate,
    TaskCreate,
    TaskUpdate,
)
from app.security.dependencies import CurrentUser, DbDep
from app.services import admin_catalog

router = APIRouter(tags=["admin: catalogue"])


@router.get("/projects", response_model=AdminProjectList)
def list_projects(
    db: DbDep,
    search: Annotated[str | None, Query(max_length=100)] = None,
    active: bool | None = None,
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> AdminProjectList:
    return admin_catalog.list_projects(
        db, search=search, active=active, page=page, page_size=page_size
    )


@router.get("/projects/{project_id}", response_model=AdminProjectRead)
def get_project(project_id: uuid.UUID, db: DbDep) -> AdminProjectRead:
    return admin_catalog.get_project(db, project_id)


@router.post("/projects", status_code=201, response_model=AdminProjectRead)
def create_project(body: ProjectCreate, actor: CurrentUser, db: DbDep) -> AdminProjectRead:
    return admin_catalog.create_project(db, actor, body)


@router.patch("/projects/{project_id}", response_model=AdminProjectRead)
def update_project(
    project_id: uuid.UUID, body: ProjectUpdate, actor: CurrentUser, db: DbDep
) -> AdminProjectRead:
    return admin_catalog.update_project(db, actor, project_id, body)


@router.get("/projects/{project_id}/tasks", response_model=AdminTaskList)
def list_tasks(project_id: uuid.UUID, db: DbDep) -> AdminTaskList:
    return admin_catalog.list_tasks(db, project_id)


@router.post("/projects/{project_id}/tasks", status_code=201, response_model=AdminTaskRead)
def create_task(
    project_id: uuid.UUID, body: TaskCreate, actor: CurrentUser, db: DbDep
) -> AdminTaskRead:
    return admin_catalog.create_task(db, actor, project_id, body)


@router.patch("/tasks/{task_id}", response_model=AdminTaskRead)
def update_task(
    task_id: uuid.UUID, body: TaskUpdate, actor: CurrentUser, db: DbDep
) -> AdminTaskRead:
    return admin_catalog.update_task(db, actor, task_id, body)


@router.get("/earning-codes", response_model=AdminEarningCodeList)
def list_earning_codes(db: DbDep) -> AdminEarningCodeList:
    return admin_catalog.list_earning_codes(db)


@router.post("/earning-codes", status_code=201, response_model=AdminEarningCodeRead)
def create_earning_code(
    body: EarningCodeCreate, actor: CurrentUser, db: DbDep
) -> AdminEarningCodeRead:
    return admin_catalog.create_earning_code(db, actor, body)


@router.patch("/earning-codes/{code_id}", response_model=AdminEarningCodeRead)
def update_earning_code(
    code_id: uuid.UUID, body: EarningCodeUpdate, actor: CurrentUser, db: DbDep
) -> AdminEarningCodeRead:
    return admin_catalog.update_earning_code(db, actor, code_id, body)
