"""Password rules (NIST SP 800-63B style: length first, no composition theatre)."""

from __future__ import annotations

import re
import secrets

MIN_LENGTH = 12
MAX_LENGTH = 128  # keeps hashing cost bounded
# A deliberately small list: the point is to stop the most obvious choices, not to be a dictionary.
COMMON = frozenset(
    {
        "password1234",
        "passw0rd1234",
        "123456789012",
        "1234567890123",
        "qwertyuiop12",
        "administrator",
        "letmein12345",
        "welcome12345",
        "changeme1234",
        "timetrack1234",
    }
)


def _squash(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def check_password(password: str, *, email: str = "", display_name: str = "") -> str | None:
    """Return a message describing the first problem, or None if the password is acceptable."""
    if len(password) < MIN_LENGTH:
        return f"Use at least {MIN_LENGTH} characters."
    if len(password) > MAX_LENGTH:
        return f"Use at most {MAX_LENGTH} characters."
    lowered = password.lower()
    if lowered in COMMON or len(set(lowered)) < 5:
        return "That password is too easy to guess. Try a longer phrase."
    # Compare on letters and digits only, so "Alex-Doe" or "a.l.e.x" cannot sneak a name in.
    squashed = _squash(password)
    local = _squash(email.split("@", 1)[0])
    if len(local) >= 4 and local in squashed:
        return "The password must not contain your email name."
    name = _squash(display_name)
    if len(name) >= 4 and name in squashed:
        return "The password must not contain your name."
    return None


def generate_temporary_password() -> str:
    """A random one-time password for an administrator to hand over (shown once, never stored)."""
    return secrets.token_urlsafe(15)
