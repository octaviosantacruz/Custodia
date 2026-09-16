-- Migration 031: explicit Safe-level account type classification.
-- This is separate from inventory_scope (business/internal Safe scope).
BEGIN;

ALTER TABLE public.cyberark_safe_metadata
  ADD COLUMN IF NOT EXISTS account_type_classification TEXT
    CHECK (account_type_classification IN ('nominal', 'no_nominal', 'internal'));

CREATE INDEX IF NOT EXISTS idx_cyberark_safe_metadata_account_type
  ON public.cyberark_safe_metadata (account_type_classification);

COMMIT;
