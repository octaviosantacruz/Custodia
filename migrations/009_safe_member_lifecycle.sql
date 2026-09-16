-- Migration 009: preserve and classify safes/members absent from a trusted snapshot.
-- Retired rows remain available for audit and can be purged explicitly later.

BEGIN;

ALTER TABLE public.safes
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('active', 'retired')),
  ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ;

ALTER TABLE public.safe_members
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('active', 'retired')),
  ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_safes_lifecycle_status
  ON public.safes (lifecycle_status);

CREATE INDEX IF NOT EXISTS idx_safe_members_lifecycle_status
  ON public.safe_members (lifecycle_status);

COMMIT;
