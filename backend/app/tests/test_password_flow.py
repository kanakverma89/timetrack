"""Password rules and the change-password flow."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AuthSession, User
from app.security import password_policy
from app.tests.factories import PASSWORD, make_user
from app.tests.support import API

URL = f"{API}/auth/change-password"
STRONG = "a-brand-new-long-passphrase"


# ---------------------------------------------------------------------------- policy


@pytest.mark.parametrize(
    "password",
    ["correct horse battery", "blue-lantern-quietly-7", "Tr0ub4dor&3-and-more", "twelve chars!!"],
)
def test_reasonable_passwords_are_accepted(password: str) -> None:
    assert (
        password_policy.check_password(password, email="sam@example.test", display_name="Sam")
        is None
    )


@pytest.mark.parametrize(
    ("password", "fragment"),
    [
        ("short", "at least 12"),
        ("x" * 129, "at most 128"),
        ("password1234", "too easy"),
        ("PASSWORD1234", "too easy"),
        ("aaaaaaaaaaaaaaaa", "too easy"),
        ("abababababab", "too easy"),
        ("my-samantha-secret-1", "email name"),
        ("hello-Alex-Doe-hello", "your name"),
        ("x.A.l.e.x.D.o.e.y!", "your name"),
    ],
)
def test_weak_passwords_are_explained(password: str, fragment: str) -> None:
    message = password_policy.check_password(
        password, email="samantha@example.test", display_name="Alex Doe"
    )
    assert message and fragment in message


def test_temporary_passwords_are_random_and_long_enough() -> None:
    values = {password_policy.generate_temporary_password() for _ in range(50)}
    assert len(values) == 50
    assert all(len(v) >= password_policy.MIN_LENGTH for v in values)


# ------------------------------------------------------------------------------ flow


def change(c: TestClient, current: str = PASSWORD, new: str = STRONG) -> Any:
    return c.post(URL, json={"current_password": current, "new_password": new})


@pytest.fixture
def person(db: Session, login_as: Any) -> TestClient:
    make_user(db, "sam@example.test")
    return login_as("sam@example.test")  # type: ignore[no-any-return]


def test_changing_the_password_works_and_ends_other_sessions_only(
    person: TestClient, db: Session, login_as: Any, make_client: Any, settings: Any
) -> None:
    other_device = login_as("sam@example.test")
    assert change(person).status_code == 204
    assert person.get(f"{API}/auth/me").status_code == 200  # this session carries on
    assert other_device.get(f"{API}/auth/me").status_code == 401  # the other one is ended
    fresh = make_client(settings)
    assert (
        fresh.post(
            f"{API}/auth/login", json={"email": "sam@example.test", "password": PASSWORD}
        ).status_code
        == 401
    )
    assert (
        fresh.post(
            f"{API}/auth/login", json={"email": "sam@example.test", "password": STRONG}
        ).status_code
        == 200
    )
    db.expire_all()
    user = db.scalars(select(User).where(User.email == "sam@example.test")).one()
    assert user.password_changed_at is not None and user.must_change_password is False
    live = [
        s
        for s in db.scalars(select(AuthSession).where(AuthSession.user_id == user.id))
        if not s.revoked_at
    ]
    assert len(live) == 2  # this device and the one just signed in


def test_a_wrong_current_password_is_a_form_error_not_a_sign_out(person: TestClient) -> None:
    response = change(person, current="not-my-password")
    assert response.status_code == 422  # a 401 would make the app think the session ended
    assert "current_password" in response.json()["error"]["field_errors"]
    assert person.get(f"{API}/auth/me").status_code == 200


@pytest.mark.parametrize(
    ("new", "fragment"),
    [
        ("short", "at least 12"),
        ("password1234", "too easy"),
        (PASSWORD, "different from the current"),
    ],
)
def test_the_new_password_must_be_acceptable_and_different(
    person: TestClient, new: str, fragment: str
) -> None:
    response = change(person, new=new)
    assert response.status_code == 422
    assert fragment in response.json()["error"]["field_errors"]["new_password"]
    assert person.post(
        f"{API}/auth/login", json={"email": "sam@example.test", "password": PASSWORD}
    ).status_code in (200, 404, 405, 422)


def test_guessing_the_current_password_is_throttled(person: TestClient) -> None:
    for _ in range(5):
        assert change(person, current="wrong-guess-here").status_code == 422
    blocked = change(person, current=PASSWORD)  # even the right one is refused now
    assert blocked.status_code == 429 and "retry-after" in blocked.headers


def test_a_successful_change_resets_the_throttle(person: TestClient) -> None:
    for _ in range(4):
        change(person, current="wrong-guess-here")
    assert change(person).status_code == 204
    for _ in range(4):
        assert (
            change(person, current="wrong-again-here", new="another-long-passphrase").status_code
            == 422
        )


def test_the_change_route_needs_a_session_the_csrf_header_and_exact_fields(
    person: TestClient, client: TestClient, make_client: Any, settings: Any
) -> None:
    assert change(client).status_code == 401
    bare = make_client(settings, headers={})
    bare.cookies.update(person.cookies)
    assert change(bare).status_code == 403
    assert person.post(URL, json={"current_password": PASSWORD}).status_code == 422
    extra = person.post(
        URL, json={"current_password": PASSWORD, "new_password": STRONG, "role": "ADMIN"}
    )
    assert extra.status_code == 422


def test_neither_password_appears_in_responses(person: TestClient) -> None:
    response = change(person)
    assert response.text == "" and STRONG not in str(response.headers)
    wrong = change(person, current="leaked-if-echoed", new=STRONG)
    assert "leaked-if-echoed" not in wrong.text and STRONG not in wrong.text


def test_nobody_can_use_the_app_with_a_pending_forced_change_except_the_change_routes(
    db: Session, login_as: Any
) -> None:
    make_user(db, "temp@example.test").must_change_password = True
    db.commit()
    c = login_as("temp@example.test")
    assert c.get(f"{API}/auth/me").status_code == 200
    for path in (
        "/meta",
        "/projects",
        "/timesheets/weeks/2026-10-19",
        "/approvals",
        "/reports/hours",
    ):
        response = c.get(f"{API}{path}")
        assert response.status_code == 403, path
        assert response.json()["error"]["code"] in {"PASSWORD_CHANGE_REQUIRED", "FORBIDDEN"}
    assert c.post(f"{API}/auth/logout").status_code == 204
