"""PENTEST-006 / IF-001: shared, atomic, bounded rate limiting.

The application-level limiter used to be an in-process AttemptRateLimiter
(app/auth.py) -- local state, reset on restart, and not coordinated across
multiple worker processes. It also had a check() -> (expensive work) ->
failed() sequence: a burst of concurrent requests could all pass check()
before any of them called failed(), letting more attempts through than the
configured limit during the race window.

This backs a single atomic UPSERT per bucket_key (e.g. "ip:1.2.3.4" or
"email:user@example.com") that every worker/process sees immediately via
the shared database, and that reserves the attempt *before* any password
verification/hashing runs -- there is no gap between "check" and "record"
for a concurrent request to exploit.

IF-001 (cross-review finding): the email dimension is caller-supplied and
unbounded in cardinality -- an unauthenticated client can send an endless
stream of distinct email strings and grow public.rate_limit_attempts
without limit, and (until this fix) those emails were stored in cleartext
indefinitely if no login for them ever succeeded. Two independent
mitigations:
  - every bucket_key is hashed (HMAC-SHA256, keyed by SESSION_SECRET) before
    it ever reaches SQL, so no raw email/IP is persisted;
  - purge_expired_attempts() bounds table growth regardless of how many
    distinct buckets were ever created, via a scheduled call (see
    app/lifecycle.py) rather than relying on every bucket eventually
    getting a successful login that clears it.
"""

import hashlib
import hmac

from psycopg_pool import AsyncConnectionPool

from app.db import fetch_one
from app.cross.services.secret_values import secret_from_environment

# Not a fresh secret to operate: SESSION_SECRET is already required and
# validated (>=32 random bytes, no known placeholder) by app/config.py for
# every auth-enabled deployment. The "ratelimit:" domain-separation prefix
# keeps this HMAC's output distinct from any other use of the same secret.
_HASH_DOMAIN = b"ratelimit:"


class RateLimitReservation(int):
    """Count-compatible result carrying the current bucket expiry."""

    def __new__(cls, count: int, retry_after_seconds: int):
        value = super().__new__(cls, count)
        value.retry_after_seconds = retry_after_seconds
        return value


def _hash_bucket_key(bucket_key: str) -> str:
    secret = secret_from_environment("SESSION_SECRET", "SESSION_SECRET_FILE").encode("utf-8")
    return hmac.new(secret, _HASH_DOMAIN + bucket_key.encode("utf-8"), hashlib.sha256).hexdigest()


async def reserve_attempt(pool: AsyncConnectionPool, bucket_key: str, window_seconds: int) -> RateLimitReservation:
    """Atomically records one attempt against bucket_key and returns the
    resulting count within the current window, resetting the window (and
    the count, to 1) if the previous one has expired. A single INSERT ...
    ON CONFLICT DO UPDATE means Postgres serializes concurrent callers for
    the same bucket_key via the row's own lock -- there is no read-then-
    write gap for a concurrent burst to exploit.

    bucket_key is hashed before it ever reaches SQL (IF-001): the stored
    row never contains the raw IP/email, only a keyed digest of it."""
    row = await fetch_one(
        pool,
        """
        INSERT INTO public.rate_limit_attempts (bucket_key, window_started_at, attempt_count)
        VALUES (%(bucket_key)s, now(), 1)
        ON CONFLICT (bucket_key) DO UPDATE SET
            attempt_count = CASE
                WHEN public.rate_limit_attempts.window_started_at <= now() - make_interval(secs => %(window_seconds)s)
                    THEN 1
                ELSE public.rate_limit_attempts.attempt_count + 1
            END,
            window_started_at = CASE
                WHEN public.rate_limit_attempts.window_started_at <= now() - make_interval(secs => %(window_seconds)s)
                    THEN now()
                ELSE public.rate_limit_attempts.window_started_at
            END
        RETURNING attempt_count,
            GREATEST(0, CEIL(EXTRACT(EPOCH FROM (
                window_started_at + make_interval(secs => %(window_seconds)s) - now()
            ))))::int AS retry_after_seconds
        """,
        {"bucket_key": _hash_bucket_key(bucket_key), "window_seconds": window_seconds},
    )
    # Keep the repository contract compatible with lightweight test doubles
    # (and older adapters) that only return the count.
    return RateLimitReservation(row["attempt_count"], row.get("retry_after_seconds", window_seconds))


async def clear_attempts(pool: AsyncConnectionPool, bucket_key: str) -> None:
    """Clears a bucket after a successful attempt."""
    async with pool.connection() as conn:
        async with conn.cursor() as cursor:
            await cursor.execute(
                "DELETE FROM public.rate_limit_attempts WHERE bucket_key = %s",
                (_hash_bucket_key(bucket_key),),
            )


async def purge_expired_attempts(pool: AsyncConnectionPool, retention_seconds: int) -> int:
    """IF-001: bounds table growth independent of how many distinct
    bucket_keys were ever created. Deletes rows whose window closed more
    than retention_seconds ago -- by then they can no longer affect any
    rate-limit decision (reserve_attempt already treats an expired window
    as a fresh one), so keeping them serves no purpose beyond an audit
    trail this table was never meant to provide. Returns the number of
    rows deleted, for observability/tests."""
    async with pool.connection() as conn:
        async with conn.cursor() as cursor:
            await cursor.execute(
                "DELETE FROM public.rate_limit_attempts WHERE window_started_at <= now() - make_interval(secs => %s)",
                (retention_seconds,),
            )
            return cursor.rowcount
