-- Migration 049: short-lived, user-issued API tokens for authenticated reads.
-- Plaintext tokens are never persisted. OIDC actors intentionally have no
-- foreign key to access_users because they are represented by role assignments.
BEGIN;

CREATE TABLE IF NOT EXISTS public.access_api_tokens (
  token_id UUID PRIMARY KEY,
  actor_id TEXT NOT NULL,
  auth_source TEXT NOT NULL CHECK (auth_source IN ('local', 'oidc')),
  session_version INTEGER,
  label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  token_hash TEXT NOT NULL CHECK (char_length(token_hash) = 64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  CHECK (
    (auth_source = 'local' AND session_version IS NOT NULL)
    OR (auth_source = 'oidc' AND session_version IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_access_api_tokens_hash
  ON public.access_api_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_access_api_tokens_actor_created
  ON public.access_api_tokens (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_api_tokens_active_expiry
  ON public.access_api_tokens (expires_at)
  WHERE revoked_at IS NULL;

COMMIT;
