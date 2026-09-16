-- Migration 008: aggregated account types from the one-time legacy inventory.
-- This is historical account inventory data. It is intentionally separate from
-- safe_members, which represents CyberArk membership/permission assignments.

BEGIN;

ALTER TABLE public.cyberark_safe_metadata
  ADD COLUMN IF NOT EXISTS inventory_account_types JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_cyberark_safe_metadata_account_types
  ON public.cyberark_safe_metadata USING GIN (inventory_account_types);

COMMIT;
