-- Only mapped groups received at login; NULL means not observed.
-- Existing roles never imply group membership.
BEGIN;
ALTER TABLE public.access_oidc_users
  ADD COLUMN observed_groups TEXT[],
  ADD COLUMN groups_observed_at TIMESTAMPTZ;
ALTER TABLE public.access_oidc_users
  ADD CONSTRAINT access_oidc_groups_observation_check
  CHECK ((observed_groups IS NULL) = (groups_observed_at IS NULL));
COMMIT;
