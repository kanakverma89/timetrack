from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict

from app.models import Classification


class ProjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    code: str
    name: str
    is_active: bool


class TaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    code: str
    name: str
    is_active: bool


class EarningCodeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    code: str
    name: str
    classification: Classification
    is_active: bool


class ProjectList(BaseModel):
    items: list[ProjectRead]


class TaskList(BaseModel):
    items: list[TaskRead]


class EarningCodeList(BaseModel):
    items: list[EarningCodeRead]
