-- ACCESS-SEG-001: narrow administrative permissions.
--
-- Purely additive. access:manage remains the compatibility superpermission;
-- no existing non-admin role receives new authority in this migration.
BEGIN;

INSERT INTO public.access_permissions
  (permission_code, domain_code, resource_code, action_code, description, lifecycle_status)
VALUES
  ('access:directory_read', 'platform', 'directory', 'read', 'Consultar personas e identidades locales/OIDC', 'active'),
  ('access:local_users_manage', 'platform', 'local_users', 'manage', 'Administrar identidades locales y sus credenciales temporales', 'active'),
  ('access:role_assignments_manage', 'platform', 'role_assignments', 'manage', 'Asignar roles dentro del techo de delegación', 'active'),
  ('access:roles_read', 'platform', 'roles', 'read', 'Consultar roles, permisos, dominios y niveles', 'active'),
  ('access:roles_manage', 'platform', 'roles', 'manage', 'Crear y modificar roles dentro del techo de delegación', 'active'),
  ('access:permissions_manage', 'platform', 'permissions', 'manage', 'Crear permisos internos; reservado al superadministrador', 'active'),
  ('access:oidc_mappings_read', 'platform', 'oidc_mappings', 'read', 'Consultar mapeos y diagnóstico OIDC no secreto', 'active'),
  ('audit:read', 'platform', 'audit', 'read', 'Consultar auditoría y registros operativos sanitizados', 'active'),
  ('security:events_read', 'platform', 'security_events', 'read', 'Consultar eventos de autenticación y seguridad sanitizados', 'active')
ON CONFLICT (permission_code) DO NOTHING;

COMMIT;
