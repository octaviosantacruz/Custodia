-- ACCESS-ROLES-002 (approved 2026-10-11): bring the seeded roles up to date.
--
-- 1. The platform administrator lists explicitly the narrow permissions that
--    access:manage already reaches through the route fallbacks, so the
--    catalog shows what the role can actually do. It also gains the strict
--    ones no role held: netskope:read (AA metrics and their contracts
--    initiate remote tasks), access:roles_manage (role dashboard templates)
--    and netskope:admin (client and OS baselines, device diagnosis).
-- 2. Netskope · Administrador reads the sensitive per-user surfaces: DLP
--    alerts and UCI. The platform administrator does NOT get them; they stay
--    out of netskope:read and access:manage.
BEGIN;

INSERT INTO public.access_role_permissions (role_code, permission_code) VALUES
  ('admin', 'access:directory_read'),
  ('admin', 'access:local_users_manage'),
  ('admin', 'access:role_assignments_manage'),
  ('admin', 'access:roles_read'),
  ('admin', 'access:roles_manage'),
  ('admin', 'access:permissions_manage'),
  ('admin', 'access:oidc_mappings_read'),
  ('admin', 'audit:read'),
  ('admin', 'security:events_read'),
  ('admin', 'pam:catalogs_read'),
  ('admin', 'sia:catalogs_read'),
  ('admin', 'identity:catalogs_read'),
  ('admin', 'netskope:read'),
  ('admin', 'netskope:admin'),
  ('netskope_admin', 'netskope:dlp_read'),
  ('netskope_admin', 'netskope:uba_read')
ON CONFLICT (role_code, permission_code) DO NOTHING;

COMMIT;
