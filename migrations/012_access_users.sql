-- Migration 012: local application users. Passwords are stored as scrypt hashes only.
BEGIN;

CREATE TABLE IF NOT EXISTS public.access_users (
  actor_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_access_users_email_lower
  ON public.access_users (lower(email));

CREATE INDEX IF NOT EXISTS idx_access_users_active
  ON public.access_users (is_active);

COMMIT;
