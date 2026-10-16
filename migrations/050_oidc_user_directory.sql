-- OIDC identities are visible in the access directory without creating a
-- local password account. Roles remain authoritative in access_user_roles.
BEGIN;

CREATE TABLE public.access_oidc_users (
  actor_id TEXT PRIMARY KEY,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_access_oidc_users_subject UNIQUE (issuer, subject)
);

COMMIT;
