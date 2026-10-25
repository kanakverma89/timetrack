"""In-process sliding-window limiter for failed login attempts.

Limitation: state is per process. Use a shared store before running multiple workers (D-5).
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from collections.abc import Callable


class FailureLimiter:
    def __init__(
        self,
        max_attempts: int,
        window_seconds: int,
        clock: Callable[[], float] = time.monotonic,
        max_keys: int = 10_000,
    ) -> None:
        self.max_attempts = max_attempts
        self.window = window_seconds
        self._clock = clock
        # Failures are keyed by address+email, which an attacker controls: without a cap, a flood of
        # made-up emails would grow this dictionary without limit.
        self.max_keys = max_keys
        self._failures: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def _prune(self, key: str, now: float) -> deque[float]:
        bucket = self._failures[key]
        while bucket and now - bucket[0] >= self.window:
            bucket.popleft()
        if not bucket:
            self._failures.pop(key, None)
        return bucket

    def is_blocked(self, key: str) -> bool:
        with self._lock:
            return len(self._prune(key, self._clock())) >= self.max_attempts

    def record_failure(self, key: str) -> None:
        with self._lock:
            now = self._clock()
            self._prune(key, now)
            if key not in self._failures and len(self._failures) >= self.max_keys:
                self._evict(now)
            self._failures[key].append(now)

    def _evict(self, now: float) -> None:
        """Drop expired keys; if still full, drop the oldest (they are the least dangerous)."""
        for key in list(self._failures):  # a copy: pruning removes emptied keys as it goes
            self._prune(key, now)
        while len(self._failures) >= self.max_keys:
            self._failures.pop(next(iter(self._failures)), None)

    def tracked_keys(self) -> int:
        with self._lock:
            return len(self._failures)

    def reset(self, key: str) -> None:
        with self._lock:
            self._failures.pop(key, None)
