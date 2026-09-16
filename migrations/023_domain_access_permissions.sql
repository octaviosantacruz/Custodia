-- Migration 023: per-domain access permissions (Admin / PAM / DLP / DSPM).
--
-- OpenDS groups its workspaces under product domains. A role must hold
-- `domain:<id>` to see that domain in the workspace switcher. PAM is the
-- current product, so every authenticated role keeps it. Admin (platform
-- governance: users + activity) stays admin-only, matching the
-- `access:manage` gate already enforced on its routes. DLP and DSPM are not
-- granted to anyone yet — those modules do not exist; granting happens in a
-- later migration when they ship.
BEGIN;

INSERT INTO public.access_role_permissions (role_code, permission_code) VALUES
  ('reader',   'domain:pam'),
  ('operator', 'domain:pam'),
  ('admin',    'domain:pam'),
  ('admin',    'domain:admin')
ON CONFLICT (role_code, permission_code) DO NOTHING;

COMMIT;
