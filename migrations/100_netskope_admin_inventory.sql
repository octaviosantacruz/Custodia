-- NSK-RBAC-001: Netskope administrators, admin roles and the API-group page map share the Netskope source as distinct
-- inventory types, behind a strict permission that neither netskope:read nor access:manage grants.
BEGIN;

ALTER TABLE public.cyberark_inventory_objects
  DROP CONSTRAINT IF EXISTS cyberark_inventory_objects_object_type_check;

ALTER TABLE public.cyberark_inventory_objects
  ADD CONSTRAINT cyberark_inventory_objects_object_type_check
    CHECK (object_type IN (
      'user', 'role', 'safe', 'platform', 'psm', 'access_policy', 'sia',
      'component', 'psm_connector', 'aim_application',
      'platform_dependent', 'platform_group', 'platform_rotational_group',
      'platform_target', 'access_asset', 'sia_connector', 'sia_resource',
      'sia_database_account', 'sia_target_set', 'identity_federation',
      'device', 'dem_site', 'netskope_group', 'netskope_policy_group',
      'netskope_role', 'netskope_admin', 'netskope_api_group'
    ));

INSERT INTO public.access_permissions
  (permission_code, domain_code, resource_code, action_code, description, lifecycle_status)
VALUES
  ('netskope:admin_inventory_read', 'dlp', 'admin_inventory', 'read',
   'Consultar los administradores de Netskope, sus roles y permisos', 'active')
ON CONFLICT (permission_code) DO NOTHING;

-- Strict like netskope:uba_read: the Netskope administrator role and the platform administrator (which holds every
-- active permission, see 098) get it; netskope:read and access:manage do not.
INSERT INTO public.access_role_permissions (role_code, permission_code)
VALUES
  ('netskope_admin', 'netskope:admin_inventory_read'),
  ('admin', 'netskope:admin_inventory_read')
ON CONFLICT (role_code, permission_code) DO NOTHING;

COMMIT;
