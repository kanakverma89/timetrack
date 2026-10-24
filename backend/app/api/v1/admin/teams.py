from __future__ import annotations

import uuid

from fastapi import APIRouter, Response

from app.schemas.admin import TeamDetail, TeamList, TeamMembers, TeamWrite
from app.security.dependencies import CurrentUser, DbDep
from app.services import admin_teams

router = APIRouter(prefix="/teams", tags=["admin: teams"])


@router.get("", response_model=TeamList)
def list_teams(db: DbDep) -> TeamList:
    return admin_teams.list_teams(db)


@router.get("/{team_id}", response_model=TeamDetail)
def get_team(team_id: uuid.UUID, db: DbDep) -> TeamDetail:
    return admin_teams.get_team(db, team_id)


@router.post("", status_code=201, response_model=TeamDetail)
def create_team(body: TeamWrite, actor: CurrentUser, db: DbDep) -> TeamDetail:
    return admin_teams.create_team(db, actor, body.name)


@router.patch("/{team_id}", response_model=TeamDetail)
def rename_team(team_id: uuid.UUID, body: TeamWrite, actor: CurrentUser, db: DbDep) -> TeamDetail:
    return admin_teams.rename_team(db, actor, team_id, body.name)


@router.put("/{team_id}/members", response_model=TeamDetail)
def set_members(team_id: uuid.UUID, body: TeamMembers, actor: CurrentUser, db: DbDep) -> TeamDetail:
    return admin_teams.set_members(db, actor, team_id, body.user_ids)


@router.delete("/{team_id}", status_code=204)
def delete_team(team_id: uuid.UUID, actor: CurrentUser, db: DbDep) -> Response:
    admin_teams.delete_team(db, actor, team_id)
    return Response(status_code=204)
