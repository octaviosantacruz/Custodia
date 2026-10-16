-- SAFE-RETENTION-002: when did a complete sync stop seeing an account?
-- Accounts only had `updated_at`, which also moves when someone reclassifies a retired
-- account, so the "retired" date could drift. A dedicated column is set once, at retirement
-- (like safes and safe_members), and cleared if the account comes back.
BEGIN;

ALTER TABLE public.cyberark_accounts
    ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ;

-- Best available value for rows retired before this migration: their last update. Rows edited
-- after retiring can be later than the real detection; new retirements are exact.
UPDATE public.cyberark_accounts
SET retired_at = updated_at
WHERE lifecycle_status = 'retired' AND retired_at IS NULL;

COMMIT;
