from __future__ import annotations

import hashlib
import hmac
import secrets


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def digest_token(token: str, secret: str) -> str:
    """Keyed digest stored in the database instead of the raw cookie value."""
    return hmac.new(secret.encode(), token.encode(), hashlib.sha256).hexdigest()
