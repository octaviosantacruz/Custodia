-- Migration 040: ACCESS-001 (Access space asset catalog). New independent
-- source_system = 'access', object_type = 'access_asset'. platformId is kept
-- only as an attribute; the PAM cross-reference is resolved with a read-time
-- exact-match join (see repositories/access_queries.py), the same pattern
-- already used for the SIA->PAM IP join and the Identity->PAM UUID bridge --
-- never a persisted cyberark_inventory_relationships row, since that table's
-- single source_system column can't represent an edge between two different
-- source systems. Aditiva: solo amplia el CHECK.
BEGIN;

ALTER TABLE public.cyberark_inventory_objects
  DROP CONSTRAINT IF EXISTS cyberark_inventory_objects_object_type_check;

ALTER TABLE public.cyberark_inventory_objects
  ADD CONSTRAINT cyberark_inventory_objects_object_type_check
    CHECK (object_type IN (
      'user', 'role', 'safe', 'platform', 'psm', 'access_policy', 'sia',
      'component', 'psm_connector', 'aim_application',
      'platform_dependent', 'platform_group', 'platform_rotational_group',
      'platform_target', 'access_asset'
    ));

COMMIT;
