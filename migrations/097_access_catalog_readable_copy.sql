-- ACCESS-UI-001 phase 3 (approved 2026-10-11): the role view shows each
-- permission's description as the capability, so the catalog says concretely
-- what it enables. Text only: no code, grant or lifecycle changes.
--
-- The `dlp` domain covers all of Netskope SSE (devices, users, DLP), so it is
-- named Netskope. catalogs:read, catalogs:write and inventory:write are legacy
-- codes no route enforces; their description says so instead of repeating the
-- text of catalogs:manage / safes:classify.
BEGIN;

UPDATE public.access_domains SET display_name = 'Netskope' WHERE domain_code = 'dlp';

UPDATE public.access_roles SET description = 'Administración de Netskope' WHERE role_code = 'netskope_admin';
UPDATE public.access_roles SET description = 'Lectura de Netskope' WHERE role_code = 'netskope_reader';

UPDATE public.access_permissions AS permission SET description = copy.description
FROM (VALUES
  ('domain:dlp', 'Ingresar a Netskope'),
  ('netskope:read', 'Ver inventario, postura, experiencia y métricas de Netskope'),
  ('netskope:admin', 'Editar las líneas base del cliente y del SO, y aceptar diagnósticos de equipos'),
  ('catalogs:read', 'Heredado: ninguna función lo exige'),
  ('catalogs:write', 'Heredado: ninguna función lo exige'),
  ('inventory:write', 'Heredado: ninguna función lo exige')
) AS copy(permission_code, description)
WHERE permission.permission_code = copy.permission_code;

COMMIT;
