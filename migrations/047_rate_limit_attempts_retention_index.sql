-- Migration 047: index for bounded rate-limit retention (IF-001).
-- purge_expired_attempts() (app/repositories/rate_limiting.py) deletes rows
-- whose window closed more than retention_seconds ago, on a schedule (see
-- app/lifecycle.py). Without this index that purge -- and any future
-- monitoring query grouping by age -- would need a full table scan as the
-- table grows from unauthenticated, attacker-controlled traffic.
BEGIN;

CREATE INDEX IF NOT EXISTS idx_rate_limit_attempts_window_started_at
  ON public.rate_limit_attempts (window_started_at);

COMMIT;
