-- Migration 038: widen the normalized CMDB object graph to cover the
-- technical PAM catalogs verified against the tenant on 2026-09-10
-- (SYS-001, PSM-001, PLAT-003, AIM-001). Aditiva: solo amplia el CHECK
-- existente de object_type, no toca filas ni columnas ya persistidas.
BEGIN;

ALTER TABLE public.cyberark_inventory_objects
  DROP CONSTRAINT IF EXISTS cyberark_inventory_objects_object_type_check;

ALTER TABLE public.cyberark_inventory_objects
  ADD CONSTRAINT cyberark_inventory_objects_object_type_check
    CHECK (object_type IN (
      'user', 'role', 'safe', 'platform', 'psm', 'access_policy', 'sia',
      'component', 'psm_connector', 'aim_application',
      'platform_dependent', 'platform_group', 'platform_rotational_group'
    ));

COMMIT;
