-- Migration 045: session revocation on password change (PENTEST-004).
-- Adds a monotonically-incrementing version stamped on the session at
-- login; require_read_access/require_write_access compare it against the
-- current row on every session-based request, so a stolen cookie stops
-- working the moment the account's password is changed, reissued, reset
-- by an admin, or the account is deactivated -- without needing
-- server-side session storage.
BEGIN;

ALTER TABLE public.access_users
  ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1;

COMMIT;
