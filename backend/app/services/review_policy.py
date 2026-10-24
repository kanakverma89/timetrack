"""Who may review whose timesheet (spec §2.4, §9 rule 2, §11.2). Pure functions, no database.

The rule is deliberately narrow and explicit:

* An employee is reviewed by the manager they are **assigned** to (``manager_id``). Sharing a team
  grants nothing.
* An administrator has explicit oversight of everyone. Their decisions are audited like any other
  (the actor is recorded), and they cannot review their own week either.
* Nobody ever reviews their own timesheet, whatever their role.
* Everyone else (including employees) has no review access at all.
"""

from __future__ import annotations

import uuid

from app.models import Role


def in_review_scope(
    *,
    actor_id: uuid.UUID,
    actor_role: Role,
    employee_id: uuid.UUID,
    employee_manager_id: uuid.UUID | None,
) -> bool:
    """May this actor *see* the employee's submitted weeks (own weeks are never in scope)?"""
    if actor_id == employee_id:
        return False
    if actor_role is Role.ADMIN:
        return True
    return actor_role is Role.MANAGER and employee_manager_id == actor_id


def is_own_week(*, actor_id: uuid.UUID, employee_id: uuid.UUID) -> bool:
    return actor_id == employee_id
