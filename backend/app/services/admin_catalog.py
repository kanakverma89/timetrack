"""Projects, tasks and earning codes (spec §7.4–7.6).

Codes are normalised (upper case) and immutable once created. Nothing is ever deleted: items are
deactivated, which stops *new* entries while leaving history intact (spec rule 16). An earning
code's classification cannot change once any entry uses it, because that would silently rewrite
the capped/non-capped totals of past weeks.
"""

from __future__ import annotations

import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import ConflictError, NotFoundError, ValidationFailedError
from app.models import (
    ConfigAction,
    ConfigEntity,
    EarningCode,
    Project,
    ProjectTask,
    TimeEntry,
    User,
)
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
from app.services import config_audit


class ClassificationLockedError(ConflictError):
    code = "CLASSIFICATION_LOCKED"
    message = "This earning code is already used by time entries, so its classification is fixed."


def _taken(what: str) -> ConflictError:
    message = f"A {what} with this code already exists."
    return ConflictError(message, field_errors={"code": message})


def _action(before_active: bool, after_active: bool) -> ConfigAction:
    if before_active and not after_active:
        return ConfigAction.DEACTIVATED
    if not before_active and after_active:
        return ConfigAction.REACTIVATED
    return ConfigAction.UPDATED


# ------------------------------------------------------------------------------- projects


def _project_read(db: Session, project: Project) -> AdminProjectRead:
    tasks = db.scalar(
        select(func.count()).select_from(ProjectTask).where(ProjectTask.project_id == project.id)
    )
    return AdminProjectRead(
        id=project.id,
        code=project.code,
        name=project.name,
        description=project.description,
        is_active=project.is_active,
        task_count=int(tasks or 0),
    )


def list_projects(
    db: Session, *, search: str | None, active: bool | None, page: int, page_size: int
) -> AdminProjectList:
    conditions = []
    if search and search.strip():
        like = f"%{search.strip().replace('%', r'\%').replace('_', r'\_')}%"
        conditions.append(
            or_(Project.code.ilike(like, escape="\\"), Project.name.ilike(like, escape="\\"))
        )
    if active is not None:
        conditions.append(Project.is_active.is_(active))
    total = db.scalar(select(func.count()).select_from(Project).where(*conditions)) or 0
    counts = (
        select(ProjectTask.project_id.label("pid"), func.count().label("n"))
        .group_by(ProjectTask.project_id)
        .subquery()
    )
    rows = db.execute(
        select(Project, func.coalesce(counts.c.n, 0))
        .outerjoin(counts, counts.c.pid == Project.id)
        .where(*conditions)
        .order_by(Project.code)
        .limit(page_size)
        .offset((page - 1) * page_size)
    ).all()
    return AdminProjectList(
        items=[
            AdminProjectRead(
                id=p.id,
                code=p.code,
                name=p.name,
                description=p.description,
                is_active=p.is_active,
                task_count=int(n),
            )
            for p, n in rows
        ],
        page=page,
        page_size=page_size,
        total=int(total),
    )


def _project(db: Session, project_id: uuid.UUID) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise NotFoundError("Project not found.")
    return project


def get_project(db: Session, project_id: uuid.UUID) -> AdminProjectRead:
    return _project_read(db, _project(db, project_id))


def create_project(db: Session, actor: User, payload: ProjectCreate) -> AdminProjectRead:
    if db.scalar(select(Project.id).where(Project.code == payload.code)):
        raise _taken("project")
    project = Project(
        code=payload.code, name=payload.name, description=payload.description, is_active=True
    )
    db.add(project)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise _taken("project") from exc
    config_audit.record(
        db,
        actor,
        entity_type=ConfigEntity.PROJECT,
        entity_id=project.id,
        action=ConfigAction.CREATED,
        label=f"{project.code} {project.name}",
    )
    db.commit()
    return _project_read(db, project)


def update_project(
    db: Session, actor: User, project_id: uuid.UUID, payload: ProjectUpdate
) -> AdminProjectRead:
    project = _project(db, project_id)
    given = payload.model_dump(exclude_unset=True)
    if not given:
        raise ValidationFailedError(
            field_errors={"request": "Provide at least one field to change."}
        )
    if given.get("is_active", True) is None or given.get("name", "x") is None:
        raise ValidationFailedError(field_errors={"request": "Fields cannot be null."})
    before = {
        "name": project.name,
        "description": project.description,
        "is_active": project.is_active,
    }
    after = {**before, **given}
    project.name, project.description, project.is_active = (
        after["name"],
        after["description"],
        after["is_active"],
    )
    diff = config_audit.changes(before, after)
    if diff:
        config_audit.record(
            db,
            actor,
            entity_type=ConfigEntity.PROJECT,
            entity_id=project.id,
            action=_action(bool(before["is_active"]), bool(after["is_active"])),
            label=f"{project.code} {project.name}",
            diff=diff,
        )
    db.commit()
    return _project_read(db, project)


# ---------------------------------------------------------------------------------- tasks


def list_tasks(db: Session, project_id: uuid.UUID) -> AdminTaskList:
    _project(db, project_id)
    tasks = db.scalars(
        select(ProjectTask).where(ProjectTask.project_id == project_id).order_by(ProjectTask.code)
    )
    return AdminTaskList(
        items=[
            AdminTaskRead(
                id=t.id, project_id=t.project_id, code=t.code, name=t.name, is_active=t.is_active
            )
            for t in tasks
        ]
    )


def _task_read(task: ProjectTask) -> AdminTaskRead:
    return AdminTaskRead(
        id=task.id,
        project_id=task.project_id,
        code=task.code,
        name=task.name,
        is_active=task.is_active,
    )


def create_task(
    db: Session, actor: User, project_id: uuid.UUID, payload: TaskCreate
) -> AdminTaskRead:
    project = _project(db, project_id)
    if db.scalar(
        select(ProjectTask.id).where(
            ProjectTask.project_id == project_id, ProjectTask.code == payload.code
        )
    ):
        raise _taken("task")
    task = ProjectTask(project_id=project_id, code=payload.code, name=payload.name, is_active=True)
    db.add(task)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise _taken("task") from exc
    config_audit.record(
        db,
        actor,
        entity_type=ConfigEntity.TASK,
        entity_id=task.id,
        action=ConfigAction.CREATED,
        label=f"{project.code}/{task.code} {task.name}",
    )
    db.commit()
    return _task_read(task)


def update_task(db: Session, actor: User, task_id: uuid.UUID, payload: TaskUpdate) -> AdminTaskRead:
    task = db.get(ProjectTask, task_id)
    if task is None:
        raise NotFoundError("Task not found.")
    given = payload.model_dump(exclude_unset=True)
    if not given:
        raise ValidationFailedError(
            field_errors={"request": "Provide at least one field to change."}
        )
    if any(v is None for v in given.values()):
        raise ValidationFailedError(field_errors={"request": "Fields cannot be null."})
    before = {"name": task.name, "is_active": task.is_active}
    after = {**before, **given}
    task.name, task.is_active = after["name"], after["is_active"]
    diff = config_audit.changes(before, after)
    if diff:
        project = db.get(Project, task.project_id)
        config_audit.record(
            db,
            actor,
            entity_type=ConfigEntity.TASK,
            entity_id=task.id,
            action=_action(bool(before["is_active"]), bool(after["is_active"])),
            label=f"{project.code if project else '?'}/{task.code} {task.name}",
            diff=diff,
        )
    db.commit()
    return _task_read(task)


# -------------------------------------------------------------------------- earning codes


def _code_read(db: Session, code: EarningCode) -> AdminEarningCodeRead:
    used = db.scalar(
        select(func.count()).select_from(TimeEntry).where(TimeEntry.earning_code_id == code.id)
    )
    return AdminEarningCodeRead(
        id=code.id,
        code=code.code,
        name=code.name,
        classification=code.classification,
        is_active=code.is_active,
        entry_count=int(used or 0),
    )


def list_earning_codes(db: Session) -> AdminEarningCodeList:
    return AdminEarningCodeList(
        items=[
            _code_read(db, c) for c in db.scalars(select(EarningCode).order_by(EarningCode.code))
        ]
    )


def create_earning_code(
    db: Session, actor: User, payload: EarningCodeCreate
) -> AdminEarningCodeRead:
    if db.scalar(select(EarningCode.id).where(EarningCode.code == payload.code)):
        raise _taken("earning code")
    code = EarningCode(
        code=payload.code, name=payload.name, classification=payload.classification, is_active=True
    )
    db.add(code)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise _taken("earning code") from exc
    config_audit.record(
        db,
        actor,
        entity_type=ConfigEntity.EARNING_CODE,
        entity_id=code.id,
        action=ConfigAction.CREATED,
        label=f"{code.code} {code.name}",
        diff={"classification": {"from": None, "to": code.classification.value}},
    )
    db.commit()
    return _code_read(db, code)


def update_earning_code(
    db: Session, actor: User, code_id: uuid.UUID, payload: EarningCodeUpdate
) -> AdminEarningCodeRead:
    code = db.get(EarningCode, code_id)
    if code is None:
        raise NotFoundError("Earning code not found.")
    given = payload.model_dump(exclude_unset=True)
    if not given:
        raise ValidationFailedError(
            field_errors={"request": "Provide at least one field to change."}
        )
    if any(v is None for v in given.values()):
        raise ValidationFailedError(field_errors={"request": "Fields cannot be null."})
    before = {"name": code.name, "classification": code.classification, "is_active": code.is_active}
    after = {**before, **given}
    if after["classification"] != before["classification"]:
        used = db.scalar(
            select(func.count()).select_from(TimeEntry).where(TimeEntry.earning_code_id == code.id)
        )
        if used:
            raise ClassificationLockedError()
    code.name, code.classification, code.is_active = (
        after["name"],
        after["classification"],
        after["is_active"],
    )
    diff = config_audit.changes(before, after)
    if diff:
        config_audit.record(
            db,
            actor,
            entity_type=ConfigEntity.EARNING_CODE,
            entity_id=code.id,
            action=_action(bool(before["is_active"]), bool(after["is_active"])),
            label=f"{code.code} {code.name}",
            diff=diff,
        )
    db.commit()
    return _code_read(db, code)
