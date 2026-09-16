-- Migration 030: explicit account-level inventory classification.
-- This is intentionally separate from Safe-level inventory_scope because a
-- Safe may contain both business and CyberArk-internal accounts.
BEGIN;

ALTER TABLE public.cyberark_accounts
  ADD COLUMN IF NOT EXISTS inventory_account_type TEXT
    CHECK (inventory_account_type IN ('nominal', 'no_nominal', 'internal'));

CREATE INDEX IF NOT EXISTS idx_cyberark_accounts_inventory_type
  ON public.cyberark_accounts (inventory_account_type);

COMMIT;
