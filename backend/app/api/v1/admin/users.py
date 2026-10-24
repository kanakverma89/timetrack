from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Query

from app.models import Role
from app.schemas.admin import (
    AdminUserList,
    AdminUserRead,
    TemporaryPassword,
    UserCreate,
    UserUpdate,
    UserWithTemporaryPassword,
)
from app.security.dependencies import CurrentUser, DbDep
from app.services import admin_users

router = APIRouter(prefix="/users", tags=["admin: users"])


@router.get("", response_model=AdminUserList)
def list_users(
    db: DbDep,
    search: Annotated[str | None, Query(max_length=100)] = None,
    role: Role | None = None,
    active: bool | None = None,
    managers_only: bool = False,
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> AdminUserList:
    return admin_users.list_users(
        db,
        search=search,
        role=role,
        active=active,
        managers_only=managers_only,
        page=page,
        page_size=page_size,
    )


@router.get("/{user_id}", response_model=AdminUserRead)
def get_user(user_id: uuid.UUID, db: DbDep) -> AdminUserRead:
    return admin_users.get_user(db, user_id)


@router.post("", status_code=201, response_model=UserWithTemporaryPassword)
def create_user(body: UserCreate, actor: CurrentUser, db: DbDep) -> UserWithTemporaryPassword:
    user, temporary = admin_users.create_user(db, actor, body)
    return UserWithTemporaryPassword(user=user, temporary_password=temporary)


@router.patch("/{user_id}", response_model=AdminUserRead)
def update_user(
    user_id: uuid.UUID, body: UserUpdate, actor: CurrentUser, db: DbDep
) -> AdminUserRead:
    return admin_users.update_user(db, actor, user_id, body)


@router.post("/{user_id}/reset-password", response_model=TemporaryPassword)
def reset_password(user_id: uuid.UUID, actor: CurrentUser, db: DbDep) -> TemporaryPassword:
    return TemporaryPassword(temporary_password=admin_users.reset_password(db, actor, user_id))
