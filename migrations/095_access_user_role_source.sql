-- ACCESS-UI-001 phase 1 (approved 2026-10-11): roles assigned in DS Hub
-- coexist with the roles an Okta login maps from groups.
--
-- Each assignment records where it came from. An OIDC login replaces only
-- its own 'oidc' rows; a 'manual' row is a human decision that no login
-- removes. Existing rows written by the OIDC sync carry granted_by = 'oidc'.
BEGIN;

ALTER TABLE public.access_user_roles
  ADD COLUMN IF NOT EXISTS assignment_source TEXT NOT NULL DEFAULT 'manual';

UPDATE public.access_user_roles SET assignment_source = 'oidc' WHERE granted_by = 'oidc';

ALTER TABLE public.access_user_roles DROP CONSTRAINT IF EXISTS access_user_roles_assignment_source_check;
ALTER TABLE public.access_user_roles
  ADD CONSTRAINT access_user_roles_assignment_source_check CHECK (assignment_source IN ('oidc', 'manual'));

COMMIT;
