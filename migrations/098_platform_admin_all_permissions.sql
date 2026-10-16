-- ACCESS-ROLES-003 (owner decision 2026-10-11): the platform administrator
-- holds every active permission of the catalog, including the strict
-- per-user Netskope reads (netskope:dlp_read, netskope:uba_read) that
-- ACCESS-ROLES-002 had kept for netskope_admin only.
--
-- Insert-only and static: a permission added by a later migration must grant
-- it to `admin` in that same migration. Planned permissions (BigID) stay out
-- until they are active. access:manage is unchanged and still does not imply
-- the strict reads by itself; the role lists them explicitly.
BEGIN;

INSERT INTO public.access_role_permissions (role_code, permission_code)
SELECT 'admin', permission.permission_code
FROM public.access_permissions permission
WHERE permission.lifecycle_status = 'active'
ON CONFLICT (role_code, permission_code) DO NOTHING;

COMMIT;
