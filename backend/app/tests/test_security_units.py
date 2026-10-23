from __future__ import annotations

from app.core.ratelimit import FailureLimiter
from app.security.passwords import hash_password, verify_password
from app.security.tokens import digest_token, new_session_token


def test_password_hash_roundtrip_and_is_argon2id() -> None:
    hashed = hash_password("a-long-test-password")
    assert hashed.startswith("$argon2id$")
    assert hashed != "a-long-test-password"
    assert verify_password(hashed, "a-long-test-password")
    assert not verify_password(hashed, "different-password")


def test_verify_without_hash_is_always_false() -> None:
    assert not verify_password(None, "anything")
    assert not verify_password("not-a-valid-hash", "anything")


def test_session_tokens_are_random_and_digest_is_keyed() -> None:
    a, b = new_session_token(), new_session_token()
    assert a != b
    assert len(a) >= 43  # 256 bits, url-safe base64
    assert digest_token(a, "key-1") == digest_token(a, "key-1")
    assert digest_token(a, "key-1") != digest_token(a, "key-2")
    assert a not in digest_token(a, "key-1")


def test_limiter_blocks_after_max_failures_and_recovers_after_window() -> None:
    now = [1000.0]
    limiter = FailureLimiter(3, 60, clock=lambda: now[0])
    for _ in range(3):
        assert not limiter.is_blocked("k")
        limiter.record_failure("k")
    assert limiter.is_blocked("k")
    assert not limiter.is_blocked("other")
    now[0] += 61
    assert not limiter.is_blocked("k")


def test_limiter_reset_clears_failures() -> None:
    limiter = FailureLimiter(2, 60)
    limiter.record_failure("k")
    limiter.record_failure("k")
    assert limiter.is_blocked("k")
    limiter.reset("k")
    assert not limiter.is_blocked("k")
