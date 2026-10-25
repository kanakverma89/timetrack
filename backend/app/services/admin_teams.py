"""Team administration. Teams group people for display; membership grants no permissions."""

from __future__ import annotations

import uuid

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import ConflictError, NotFoundError, ValidationFailedError
from app.models import ConfigAction, ConfigEntity, Team, TeamMembership, User
from app.schemas.admin import TeamDetail, TeamList, TeamRead
from app.schemas.approval import PersonRef
from app.services import config_audit

_TAKEN = {"name": "A team with this name already exists."}


def _members(db: Session, team_id: uuid.UUID) -> list[User]:
    return list(
        db.scalars(
            select(User)
            .join(TeamMembership, TeamMembership.user_id == User.id)
            .where(TeamMembership.team_id == team_id)
            .order_by(func.lower(User.display_name), User.id)
        )
    )


def _team(db: Session, team_id: uuid.UUID) -> Team:
    team = db.get(Team, team_id)
    if team is None:
        raise NotFoundError("Team not found.")
    return team


def list_teams(db: Session) -> TeamList:
    counts = {
        team_id: n
        for team_id, n in db.execute(
            select(TeamMembership.team_id, func.count()).group_by(TeamMembership.team_id)
        ).all()
    }
    teams = db.scalars(select(Team).order_by(func.lower(Team.name), Team.id))
    return TeamList(
        items=[TeamRead(id=t.id, name=t.name, member_count=int(counts.get(t.id, 0))) for t in teams]
    )


def get_team(db: Session, team_id: uuid.UUID) -> TeamDetail:
    team = _team(db, team_id)
    members = _members(db, team.id)
    return TeamDetail(
        id=team.id,
        name=team.name,
        member_count=len(members),
        members=[PersonRef.model_validate(m) for m in members],
    )


def create_team(db: Session, actor: User, name: str) -> TeamDetail:
    if db.scalar(select(Team.id).where(func.lower(Team.name) == name.lower())):
        raise ConflictError(_TAKEN["name"], field_errors=_TAKEN)
    team = Team(name=name)
    db.add(team)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError(_TAKEN["name"], field_errors=_TAKEN) from exc
    config_audit.record(
        db,
        actor,
        entity_type=ConfigEntity.TEAM,
        entity_id=team.id,
        action=ConfigAction.CREATED,
        label=name,
    )
    db.commit()
    return get_team(db, team.id)


def rename_team(db: Session, actor: User, team_id: uuid.UUID, name: str) -> TeamDetail:
    team = _team(db, team_id)
    clash = db.scalar(
        select(Team.id).where(func.lower(Team.name) == name.lower(), Team.id != team.id)
    )
    if clash:
        raise ConflictError(_TAKEN["name"], field_errors=_TAKEN)
    old = team.name
    if old != name:
        team.name = name
        config_audit.record(
            db,
            actor,
            entity_type=ConfigEntity.TEAM,
            entity_id=team.id,
            action=ConfigAction.UPDATED,
            label=name,
            diff={"name": {"from": old, "to": name}},
        )
    db.commit()
    return get_team(db, team.id)


def delete_team(db: Session, actor: User, team_id: uuid.UUID) -> None:
    team = _team(db, team_id)
    removed = len(_members(db, team.id))
    config_audit.record(
        db,
        actor,
        entity_type=ConfigEntity.TEAM,
        entity_id=team.id,
        action=ConfigAction.DELETED,
        label=team.name,
        diff={"members_removed": {"from": removed, "to": 0}},
    )
    db.execute(delete(TeamMembership).where(TeamMembership.team_id == team.id))
    db.delete(team)
    db.commit()


def set_members(
    db: Session, actor: User, team_id: uuid.UUID, user_ids: list[uuid.UUID]
) -> TeamDetail:
    """Replace the member list. Adding requires active users; existing members may be removed."""
    team = _team(db, team_id)
    wanted = set(user_ids)
    current = {m.id: m for m in _members(db, team.id)}
    to_add = wanted - set(current)
    to_remove = set(current) - wanted

    added_users = (
        {u.id: u for u in db.scalars(select(User).where(User.id.in_(to_add)))} if to_add else {}
    )
    unknown = to_add - set(added_users)
    inactive = {uid for uid, u in added_users.items() if not u.is_active}
    if unknown or inactive:
        raise ValidationFailedError(
            field_errors={"user_ids": "Members must be existing, active users."}
        )
    for uid in to_remove:
        db.execute(
            delete(TeamMembership).where(
                TeamMembership.team_id == team.id, TeamMembership.user_id == uid
            )
        )
    for uid in to_add:
        db.add(TeamMembership(team_id=team.id, user_id=uid))
    if to_add or to_remove:
        config_audit.record(
            db,
            actor,
            entity_type=ConfigEntity.TEAM,
            entity_id=team.id,
            action=ConfigAction.MEMBERS_CHANGED,
            label=team.name,
            # Ids, not emails: the trail is append-only, so it must not hold personal data that a
            # later anonymisation could not remove. Names are looked up when the trail is read.
            diff={
                "added": {"from": [], "to": sorted(str(u) for u in to_add)},
                "removed": {"from": sorted(str(u) for u in to_remove), "to": []},
            },
        )
    db.commit()
    return get_team(db, team.id)
