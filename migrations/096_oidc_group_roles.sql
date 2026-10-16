-- ACCESS-UI-001 phase 2 (approved 2026-10-11): the Okta group -> DS Hub role
-- mapping is edited from the UI instead of OIDC_ROLE_MAP_JSON.
--
-- A group may grant several roles. Until the state row exists the login keeps
-- reading OIDC_ROLE_MAP_JSON; the first save from the UI copies that mapping
-- here and inserts the state row in the same transaction. From then on this
-- table is the only source, even when empty.
BEGIN;

CREATE TABLE IF NOT EXISTS public.access_oidc_group_roles (
  group_name TEXT NOT NULL CHECK (length(btrim(group_name)) BETWEEN 1 AND 256),
  role_code TEXT NOT NULL REFERENCES public.access_roles(role_code),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by TEXT NOT NULL,
  PRIMARY KEY (group_name, role_code)
);

CREATE TABLE IF NOT EXISTS public.access_oidc_mapping_state (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  managed_since TIMESTAMPTZ NOT NULL DEFAULT now(),
  managed_by TEXT NOT NULL
);

COMMIT;
