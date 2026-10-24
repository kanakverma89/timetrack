from __future__ import annotations

import inspect
import itertools
import uuid

import pytest

from app.models import Role
from app.services import review_policy as policy

A, B, C = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()


def scope(
    actor_id: uuid.UUID, role: Role, employee_id: uuid.UUID, manager: uuid.UUID | None
) -> bool:
    return policy.in_review_scope(
        actor_id=actor_id, actor_role=role, employee_id=employee_id, employee_manager_id=manager
    )


def test_a_manager_reviews_only_their_assigned_reports() -> None:
    assert scope(A, Role.MANAGER, B, manager=A) is True
    assert scope(A, Role.MANAGER, B, manager=C) is False  # someone else's report
    assert scope(A, Role.MANAGER, B, manager=None) is False  # unassigned: nobody's by default


def test_an_administrator_has_oversight_of_everyone_else() -> None:
    assert scope(A, Role.ADMIN, B, manager=C) is True
    assert scope(A, Role.ADMIN, B, manager=None) is True


def test_employees_have_no_review_access_even_when_named_as_manager() -> None:
    assert scope(A, Role.EMPLOYEE, B, manager=A) is False


@pytest.mark.parametrize("role", list(Role))
def test_nobody_reviews_their_own_week(role: Role) -> None:
    assert scope(A, role, A, manager=A) is False
    assert policy.is_own_week(actor_id=A, employee_id=A) is True
    assert policy.is_own_week(actor_id=A, employee_id=B) is False


def test_team_membership_is_not_an_input_at_all() -> None:
    # The policy signature has no team parameter: sharing a team can never grant access.
    names = set(inspect.signature(policy.in_review_scope).parameters)
    assert names == {"actor_id", "actor_role", "employee_id", "employee_manager_id"}


def test_exhaustive_truth_table() -> None:
    ids = [A, B, C, None]
    for role, actor, employee, manager in itertools.product(list(Role), [A, B], [A, B, C], ids):
        expected = actor != employee and (
            role is Role.ADMIN or (role is Role.MANAGER and manager == actor)
        )
        assert scope(actor, role, employee, manager) is expected
