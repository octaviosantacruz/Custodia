-- NSK-USR-001: the rest of the Netskope console header kept beside the user total of migration 086:
-- enabled and disabled accounts, groups and OUs. Reference only, like the user total; nullable because
-- an odd value in the payload is dropped instead of stored.
BEGIN;

ALTER TABLE public.netskope_reported_counts
    ADD COLUMN IF NOT EXISTS active_accounts INTEGER CHECK (active_accounts >= 0),
    ADD COLUMN IF NOT EXISTS inactive_accounts INTEGER CHECK (inactive_accounts >= 0),
    ADD COLUMN IF NOT EXISTS total_groups INTEGER CHECK (total_groups >= 0),
    ADD COLUMN IF NOT EXISTS total_ous INTEGER CHECK (total_ous >= 0);

COMMIT;
