-- Migration 021: persist the non-secret account inventory for Safe visibility.
-- Account passwords and secret payloads are never stored here.
BEGIN;

CREATE TABLE IF NOT EXISTS public.cyberark_accounts (
  account_row_id       BIGSERIAL PRIMARY KEY,
  safe_number          INT NOT NULL REFERENCES public.safes(safe_number),
  account_id           TEXT NOT NULL,
  account_name         TEXT NOT NULL,
  user_name            TEXT,
  address              TEXT,
  platform_id          TEXT,
  platform_name        TEXT,
  lifecycle_status     TEXT NOT NULL DEFAULT 'active'
                       CHECK (lifecycle_status IN ('active', 'retired')),
  first_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_run_id        UUID,
  attributes           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (safe_number, account_id)
);

CREATE INDEX IF NOT EXISTS idx_cyberark_accounts_safe_lifecycle
  ON public.cyberark_accounts (safe_number, lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_cyberark_accounts_name
  ON public.cyberark_accounts (lower(account_name));
CREATE INDEX IF NOT EXISTS idx_cyberark_accounts_platform
  ON public.cyberark_accounts (platform_id);

COMMIT;
