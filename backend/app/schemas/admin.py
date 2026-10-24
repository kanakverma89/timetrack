from __future__ import annotations

import re
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models import Classification, ConfigAction, ConfigEntity, Role
from app.schemas.approval import PersonRef

EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
CODE = re.compile(r"^[A-Z0-9][A-Z0-9_.-]{0,49}$")


def _strip(value: str) -> str:
    return value.strip()


def normalize_code(value: str) -> str:
    return value.strip().upper()


class Page(BaseModel):
    page: int
    page_size: int
    total: int


# ---------------------------------------------------------------------------------- users


class AdminUserRead(BaseModel):
    id: uuid.UUID
    email: str
    display_name: str
    role: Role
    is_active: bool
    manager: PersonRef | None
    report_count: int
    must_change_password: bool
    created_at: datetime


class AdminUserList(Page):
    items: list[AdminUserRead]


class UserCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(max_length=320)
    display_name: str = Field(min_length=1, max_length=200)
    role: Role
    manager_id: uuid.UUID | None = None

    @field_validator("email")
    @classmethod
    def _email(cls, value: str) -> str:
        value = value.strip().lower()
        if not EMAIL.match(value):
            raise ValueError("Enter a valid email address.")
        return value

    @field_validator("display_name")
    @classmethod
    def _name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Name is required.")
        return value


class UserUpdate(BaseModel):
    """Partial update. ``manager_id: null`` explicitly removes the assignment."""

    model_config = ConfigDict(extra="forbid")

    display_name: str | None = Field(default=None, min_length=1, max_length=200)
    role: Role | None = None
    manager_id: uuid.UUID | None = None
    is_active: bool | None = None

    @field_validator("display_name")
    @classmethod
    def _name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("Name is required.")
        return value


class UserWithTemporaryPassword(BaseModel):
    user: AdminUserRead
    #: Shown exactly once. It is never stored (only its hash) and never written to any log.
    temporary_password: str


class TemporaryPassword(BaseModel):
    temporary_password: str


# ---------------------------------------------------------------------------------- teams


class TeamRead(BaseModel):
    id: uuid.UUID
    name: str
    member_count: int


class TeamDetail(TeamRead):
    members: list[PersonRef]


class TeamList(BaseModel):
    items: list[TeamRead]


class TeamWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Name is required.")
        return value


class TeamMembers(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_ids: list[uuid.UUID] = Field(max_length=1000)


# ------------------------------------------------------------------------------- catalogue


class AdminProjectRead(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    description: str | None
    is_active: bool
    task_count: int


class AdminProjectList(Page):
    items: list[AdminProjectRead]


class ProjectCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)

    @field_validator("code")
    @classmethod
    def _code(cls, value: str) -> str:
        value = normalize_code(value)
        if not CODE.match(value):
            raise ValueError(
                "Use letters, digits, dots, hyphens or underscores (start with a letter or digit)."
            )
        return value

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Name is required.")
        return value


class ProjectUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    is_active: bool | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("Name is required.")
        return value


class AdminTaskRead(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    code: str
    name: str
    is_active: bool


class AdminTaskList(BaseModel):
    items: list[AdminTaskRead]


class TaskCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=200)

    @field_validator("code")
    @classmethod
    def _code(cls, value: str) -> str:
        value = normalize_code(value)
        if not CODE.match(value):
            raise ValueError(
                "Use letters, digits, dots, hyphens or underscores (start with a letter or digit)."
            )
        return value

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Name is required.")
        return value


class TaskUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=200)
    is_active: bool | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("Name is required.")
        return value


class AdminEarningCodeRead(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    classification: Classification
    is_active: bool
    entry_count: int


class AdminEarningCodeList(BaseModel):
    items: list[AdminEarningCodeRead]


class EarningCodeCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=200)
    classification: Classification

    @field_validator("code")
    @classmethod
    def _code(cls, value: str) -> str:
        value = normalize_code(value)
        if not CODE.match(value):
            raise ValueError(
                "Use letters, digits, dots, hyphens or underscores (start with a letter or digit)."
            )
        return value

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Name is required.")
        return value


class EarningCodeUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=200)
    classification: Classification | None = None
    is_active: bool | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("Name is required.")
        return value


# ---------------------------------------------------------------------------------- policy


class PolicyRead(BaseModel):
    max_hours_per_entry: Decimal
    max_hours_per_day: Decimal | None
    max_hours_per_week: Decimal | None
    description_max_length: int
    source: str
    updated_at: datetime | None
    updated_by_name: str | None
    #: What the environment would apply if the database override were removed.
    environment_defaults: dict[str, Any]


class PolicyWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_hours_per_entry: Decimal = Field(gt=0, le=24, decimal_places=2)
    max_hours_per_day: Decimal | None = Field(default=None, gt=0, le=24, decimal_places=2)
    max_hours_per_week: Decimal | None = Field(default=None, gt=0, le=168, decimal_places=2)
    description_max_length: int = Field(ge=1, le=256)


# ----------------------------------------------------------------------------------- audit


class AuditItem(BaseModel):
    id: uuid.UUID
    created_at: datetime
    actor: PersonRef
    entity_type: ConfigEntity
    entity_id: uuid.UUID | None
    action: ConfigAction
    details: dict[str, Any]


class AuditList(Page):
    items: list[AuditItem]
