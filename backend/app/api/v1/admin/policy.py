from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Query

from app.models import ConfigEntity
from app.schemas.admin import AuditList, PolicyRead, PolicyWrite
from app.security.dependencies import CurrentUser, DbDep, SettingsDep
from app.services import admin_policy

router = APIRouter(tags=["admin: policy and audit"])


@router.get("/policy", response_model=PolicyRead)
def get_policy(db: DbDep, settings: SettingsDep) -> PolicyRead:
    return admin_policy.get_policy(db, settings)


@router.put("/policy", response_model=PolicyRead)
def put_policy(
    body: PolicyWrite, actor: CurrentUser, db: DbDep, settings: SettingsDep
) -> PolicyRead:
    return admin_policy.update_policy(db, actor, settings, body)


@router.delete("/policy", response_model=PolicyRead)
def reset_policy(actor: CurrentUser, db: DbDep, settings: SettingsDep) -> PolicyRead:
    """Remove the override so the environment defaults apply again; returns the policy in force."""
    return admin_policy.reset_policy(db, actor, settings)


@router.get("/audit", response_model=AuditList)
def list_audit(
    db: DbDep,
    entity_type: ConfigEntity | None = None,
    entity_id: uuid.UUID | None = None,
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> AuditList:
    return admin_policy.list_audit(
        db, entity_type=entity_type, entity_id=entity_id, page=page, page_size=page_size
    )
