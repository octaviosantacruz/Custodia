-- Migration 046: shared, atomic rate limiting for login/bootstrap (PENTEST-006).
-- The previous limiter (AttemptRateLimiter) was local to each process --
-- reset on restart and not coordinated across multiple workers -- and its
-- check() -> hash() -> failed() sequence let a concurrent burst pass the
-- check before any of it was recorded. This table backs a single atomic
-- UPSERT ("reserve the attempt, then verify the credential") shared by
-- every worker/process talking to the same database, closing both gaps.
BEGIN;

CREATE TABLE IF NOT EXISTS public.rate_limit_attempts (
    bucket_key TEXT PRIMARY KEY,
    window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempt_count INTEGER NOT NULL DEFAULT 0
);

COMMIT;
