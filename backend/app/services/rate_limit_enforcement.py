"""PENTEST-006: shared, atomic rate limiting enforcement for
unauthenticated, CPU-expensive endpoints (login, bootstrap).

Split out of app/auth.py so that module stays focused on session/permission
dependencies; this one owns only "should this request be allowed to even
attempt the expensive work" policy, backed by
app/repositories/rate_limiting.py.
"""

import asyncio

from fastapi import HTTPException

from ..repositories.rate_limiting import clear_attempts, reserve_attempt

LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 10
LOGIN_RATE_LIMIT_WINDOW_SECONDS = 60
BOOTSTRAP_RATE_LIMIT_MAX_ATTEMPTS = 5
BOOTSTRAP_RATE_LIMIT_WINDOW_SECONDS = 300


async def enforce_rate_limit(pool, bucket_keys: list[str], *, max_attempts: int, window_seconds: int) -> None:
    """PENTEST-006: reserves an attempt atomically (via the shared database,
    coordinated across every worker/process) for each bucket_key *before*
    any expensive work -- e.g. password hashing -- runs, and 429s if any of
    them is already over the limit. Reserving first and only then doing the
    expensive work closes the check()-then-later-failed() race the old
    in-process AttemptRateLimiter had: there is no window between "check"
    and "record" for a concurrent burst to slip through.

    Every bucket_key is reserved concurrently (not short-circuited on the
    first over-limit key): with independent dimensions like IP and email,
    there is no ordering dependency between them, and reserving all of them
    regardless of the others' state keeps each dimension's count accurate
    even when a different dimension is the one blocking the request.
    """
    counts = await asyncio.gather(*(reserve_attempt(pool, bucket_key, window_seconds) for bucket_key in bucket_keys))
    if any(count > max_attempts for count in counts):
        # A request can be blocked by more than one dimension (IP and email).
        # Waiting for the longest remaining bucket is the only value that
        # guarantees the next attempt is not immediately rejected again.
        retry_after = max((getattr(count, "retry_after_seconds", window_seconds) for count in counts), default=window_seconds)
        raise HTTPException(status_code=429, detail="Demasiados intentos. Probá nuevamente más tarde.", headers={"Retry-After": str(max(1, retry_after))})


async def clear_rate_limit(pool, bucket_keys: list[str]) -> None:
    """Clears every bucket_key after a successful attempt."""
    await asyncio.gather(*(clear_attempts(pool, bucket_key) for bucket_key in bucket_keys))
