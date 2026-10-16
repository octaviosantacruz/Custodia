-- COV-001 (approved 2026-10-14): paired read/manage permissions for Safes and for Cobertura (the destination inventory).
--
--   safes:read      replaces inventory:read on the Safe and account read routes.
--   safes:manage    replaces safes:classify and safes:bulk_classify on every Safe/account classification write.
--   coverage:read   opens the destination inventory (it was open to any inventory:read holder).
--   coverage:manage replaces connections:import and also covers editing and exporting the inventory.
--
-- Roles hold permissions directly (system and custom), so each new code is granted to every role that already holds
-- the equivalent one: nobody gains or loses access on the day this runs. inventory:read, inventory:export and the
-- other codes are unchanged (Safe/account CSV exports still require inventory:export). The old classify/import
-- codes stay in the catalog as legacy: no route enforces them any more.
BEGIN;

INSERT INTO public.access_permissions
  (permission_code, domain_code, resource_code, action_code, description, lifecycle_status)
VALUES
  ('safes:read', 'pam', 'safes', 'read', 'Consultar Safes, sus miembros y sus cuentas', 'active'),
  ('safes:manage', 'pam', 'safes', 'manage', 'Clasificar Safes y cuentas, también en forma masiva', 'active'),
  ('coverage:read', 'pam', 'coverage', 'read', 'Consultar la cobertura de destinos en Privilege Cloud y SIA', 'active'),
  ('coverage:manage', 'pam', 'coverage', 'manage', 'Importar, exportar y editar el inventario de destinos y su estado', 'active')
ON CONFLICT (permission_code) DO NOTHING;

INSERT INTO public.access_role_permissions (role_code, permission_code)
SELECT DISTINCT grant_row.role_code, mapping.new_code
FROM (VALUES
  ('inventory:read', 'safes:read'),
  ('inventory:read', 'coverage:read'),
  ('safes:classify', 'safes:manage'),
  ('safes:bulk_classify', 'safes:manage'),
  ('connections:import', 'coverage:manage')
) AS mapping(old_code, new_code)
JOIN public.access_role_permissions grant_row ON grant_row.permission_code = mapping.old_code
ON CONFLICT (role_code, permission_code) DO NOTHING;

-- The platform administrator holds every active permission (see 098).
INSERT INTO public.access_role_permissions (role_code, permission_code)
VALUES ('admin', 'safes:read'), ('admin', 'safes:manage'), ('admin', 'coverage:read'), ('admin', 'coverage:manage')
ON CONFLICT (role_code, permission_code) DO NOTHING;

UPDATE public.access_permissions AS permission SET description = copy.description
FROM (VALUES
  ('safes:classify', 'Heredado: lo reemplazó safes:manage'),
  ('safes:bulk_classify', 'Heredado: lo reemplazó safes:manage'),
  ('connections:import', 'Heredado: lo reemplazó coverage:manage')
) AS copy(permission_code, description)
WHERE permission.permission_code = copy.permission_code;

COMMIT;
