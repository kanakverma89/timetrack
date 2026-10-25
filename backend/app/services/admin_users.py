"""User administration (spec Phase 7). All writes are audited in the same transaction.

Safety rules, because an administrator can otherwise lock everyone out or strand reviews:

* you cannot change your own role or deactivate yourself;
* the last active administrator cannot be removed;
* a manager with active reports cannot lose the role or be deactivated until the reports are
  reassigned (otherwise their submitted weeks would have nobody to review them);
* a manager must be active and a MANAGER or ADMIN, and management chains cannot form a loop;
* deactivation ends every session immediately and never deletes history.
"""

from __future__ import annotations

import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from app.core.errors import ConflictError, NotFoundError, ValidationFailedError
from app.models import ConfigAction, ConfigEntity, Role, User
from app.repositories import sessions as session_repo
from app.schemas.admin import AdminUserList, AdminUserRead, UserCreate, UserUpdate
from app.schemas.approval import PersonRef
from app.security.password_policy import generate_temporary_password
from app.security.passwords import hash_password
from app.services import config_audit

MAX_CHAIN = 50
CAN_MANAGE = (Role.MANAGER, Role.ADMIN)


class LastAdminError(ConflictError):
    code = "LAST_ADMIN"
    message = "There must always be at least one active administrator."


def _read(db: Session, user: User) -> AdminUserRead:
    manager = db.get(User, user.manager_id) if user.manager_id else None
    reports = db.scalar(
        select(func.count()).select_from(User).where(User.manager_id == user.id, User.is_active)
    )
    return AdminUserRead(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        role=user.role,
        is_active=user.is_active,
        manager=PersonRef.model_validate(manager) if manager else None,
        report_count=int(reports or 0),
        must_change_password=user.must_change_password,
        created_at=user.created_at,
    )


def list_users(
    db: Session,
    *,
    search: str | None,
    role: Role | None,
    active: bool | None,
    managers_only: bool,
    page: int,
    page_size: int,
) -> AdminUserList:
    conditions = []
    if search and search.strip():
        like = f"%{search.strip().replace('%', r'\%').replace('_', r'\_')}%"
        conditions.append(
            or_(User.email.ilike(like, escape="\\"), User.display_name.ilike(like, escape="\\"))
        )
    if role is not None:
        conditions.append(User.role == role)
    if active is not None:
        conditions.append(User.is_active.is_(active))
    if managers_only:  # people who can be chosen as someone's manager
        conditions.append(User.role.in_(CAN_MANAGE))
        conditions.append(User.is_active.is_(True))
    total = db.scalar(select(func.count()).select_from(User).where(*conditions)) or 0

    reports = aliased(User)
    counts = (
        select(reports.manager_id.label("mid"), func.count().label("n"))
        .where(reports.is_active.is_(True), reports.manager_id.is_not(None))
        .group_by(reports.manager_id)
        .subquery()
    )
    manager = aliased(User)
    rows = db.execute(
        select(User, manager, func.coalesce(counts.c.n, 0))
        .outerjoin(manager, manager.id == User.manager_id)
        .outerjoin(counts, counts.c.mid == User.id)
        .where(*conditions)
        .order_by(func.lower(User.display_name), User.id)
        .limit(page_size)
        .offset((page - 1) * page_size)
    ).all()
    return AdminUserList(
        items=[
            AdminUserRead(
                id=u.id,
                email=u.email,
                display_name=u.display_name,
                role=u.role,
                is_active=u.is_active,
                manager=PersonRef.model_validate(m) if m else None,
                report_count=int(n),
                must_change_password=u.must_change_password,
                created_at=u.created_at,
            )
            for u, m, n in rows
        ],
        page=page,
        page_size=page_size,
        total=int(total),
    )


def get_user(db: Session, user_id: uuid.UUID) -> AdminUserRead:
    user = db.get(User, user_id)
    if user is None:
        raise NotFoundError("User not found.")
    return _read(db, user)


def _check_manager(db: Session, manager_id: uuid.UUID, target_id: uuid.UUID | None) -> User:
    manager = db.get(User, manager_id)
    if manager is None or not manager.is_active or manager.role not in CAN_MANAGE:
        raise ValidationFailedError(
            field_errors={"manager_id": "Choose an active manager or administrator."}
        )
    if target_id is not None:
        # Walk up the chain: if we meet the target again, the assignment would form a loop.
        current: User | None = manager
        for _ in range(MAX_CHAIN):
            if current is None:
                break
            if current.id == target_id:
                raise ValidationFailedError(
                    field_errors={"manager_id": "That would make a management loop."}
                )
            current = db.get(User, current.manager_id) if current.manager_id else None
    return manager


def _active_reports(db: Session, user_id: uuid.UUID) -> int:
    return int(
        db.scalar(
            select(func.count()).select_from(User).where(User.manager_id == user_id, User.is_active)
        )
        or 0
    )


def create_user(db: Session, actor: User, payload: UserCreate) -> tuple[AdminUserRead, str]:
    if db.scalar(select(User.id).where(User.email == payload.email)):
        raise ConflictError(
            "A user with this email already exists.",
            field_errors={"email": "A user with this email already exists."},
        )
    if payload.manager_id is not None:
        _check_manager(db, payload.manager_id, None)
    temporary = generate_temporary_password()
    user = User(
        email=payload.email,
        display_name=payload.display_name,
        role=payload.role,
        manager_id=payload.manager_id,
        is_active=True,
        password_hash=hash_password(temporary),
        must_change_password=True,
    )
    db.add(user)
    try:
        db.flush()
    except IntegrityError as exc:  # a concurrent create of the same email
        db.rollback()
        raise ConflictError(
            "A user with this email already exists.",
            field_errors={"email": "A user with this email already exists."},
        ) from exc
    config_audit.record(
        db,
        actor,
        entity_type=ConfigEntity.USER,
        entity_id=user.id,
        action=ConfigAction.CREATED,
        label=str(user.id),
        diff={
            "role": {"from": None, "to": user.role.value},
            "manager_id": {"from": None, "to": str(user.manager_id) if user.manager_id else None},
        },
    )
    db.commit()
    return _read(db, user), temporary


def update_user(db: Session, actor: User, user_id: uuid.UUID, payload: UserUpdate) -> AdminUserRead:
    user = db.get(User, user_id)
    if user is None:
        raise NotFoundError("User not found.")
    given = payload.model_dump(exclude_unset=True)
    if not given:
        raise ValidationFailedError(
            field_errors={"request": "Provide at least one field to change."}
        )
    for field in ("display_name", "role", "is_active"):
        if field in given and given[field] is None:
            raise ValidationFailedError(field_errors={field: "This field cannot be null."})

    before = {
        "display_name": user.display_name,
        "role": user.role,
        "manager_id": user.manager_id,
        "is_active": user.is_active,
    }
    after = {**before, **given}
    errors: dict[str, str] = {}

    if actor.id == user.id:
        if after["role"] != before["role"]:
            errors["role"] = "You cannot change your own role."
        if after["is_active"] is False and before["is_active"]:
            errors["is_active"] = "You cannot deactivate yourself."
    if after["manager_id"] is not None and after["manager_id"] != before["manager_id"]:
        try:
            _check_manager(db, after["manager_id"], user.id)
        except ValidationFailedError as exc:
            errors.update(exc.field_errors)
    elif after["manager_id"] == user.id:
        errors["manager_id"] = "Nobody can manage themselves."

    loses_management = (before["role"] in CAN_MANAGE and after["role"] not in CAN_MANAGE) or (
        before["is_active"] and not after["is_active"]
    )
    reports = _active_reports(db, user.id) if loses_management else 0
    if reports:
        key = "is_active" if not after["is_active"] else "role"
        errors.setdefault(
            key, f"Reassign their {reports} active report{'s' if reports != 1 else ''} first."
        )
    if errors:
        raise ValidationFailedError(field_errors=errors)

    removes_admin = (
        before["role"] is Role.ADMIN
        and before["is_active"]
        and (after["role"] is not Role.ADMIN or not after["is_active"])
    )
    if removes_admin:
        # Lock every active admin row first. Two administrators removing each other at the same
        # instant would otherwise both see "someone else remains" and leave nobody in charge; with
        # the lock the second one waits, then sees the first one's committed change.
        active_admins = db.scalars(
            select(User.id).where(User.role == Role.ADMIN, User.is_active).with_for_update()
        ).all()
        if not [uid for uid in active_admins if uid != user.id]:
            raise LastAdminError()

    user.display_name = after["display_name"]
    user.role = after["role"]
    user.manager_id = after["manager_id"]
    user.is_active = after["is_active"]
    if before["is_active"] and not after["is_active"]:
        session_repo.revoke_all_for_user(db, user.id)  # signed out everywhere, immediately

    diff = config_audit.changes(before, after)
    if "display_name" in diff:
        # The audit trail is append-only, so it must never hold personal data that anonymisation
        # could not later remove: record that a name changed, not what it was.
        diff["display_name"] = {"changed": True}
    if diff:
        action = ConfigAction.UPDATED
        if "is_active" in diff:
            action = (
                ConfigAction.DEACTIVATED if not after["is_active"] else ConfigAction.REACTIVATED
            )
        config_audit.record(
            db,
            actor,
            entity_type=ConfigEntity.USER,
            entity_id=user.id,
            action=action,
            label=str(user.id),
            diff=diff,
        )
    db.commit()
    return _read(db, user)


def reset_password(db: Session, actor: User, user_id: uuid.UUID) -> str:
    user = db.get(User, user_id)
    if user is None:
        raise NotFoundError("User not found.")
    if user.id == actor.id:
        raise ValidationFailedError(
            field_errors={"request": "Use “Change password” for your own account."}
        )
    temporary = generate_temporary_password()
    user.password_hash = hash_password(temporary)
    user.must_change_password = True
    session_repo.revoke_all_for_user(db, user.id)
    config_audit.record(
        db,
        actor,
        entity_type=ConfigEntity.USER,
        entity_id=user.id,
        action=ConfigAction.PASSWORD_RESET,
        label=str(user.id),
    )
    db.commit()
    return temporary
