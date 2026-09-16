-- Migration 022: force administrator-created local users to replace temporary passwords.
BEGIN;
ALTER TABLE public.access_users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;
COMMIT;
