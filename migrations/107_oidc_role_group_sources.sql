-- ACCESS-UI-001: evidence of the exact group-to-role map used at login.
-- NULL means no historical evidence; never backfill from today's mapping.
-- A role with [] was granted by OIDC_DEFAULT_ROLE rather than a mapped group.
BEGIN;
ALTER TABLE public.access_oidc_users
    ADD COLUMN IF NOT EXISTS role_group_sources JSONB;
COMMIT;
