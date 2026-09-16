-- Migration 039: PLAT-002 (CPM/workflow policy per destination "target"
-- platform) turned out to use its own numeric ID space and Name field that
-- only sometimes equals a PlatformID string -- joining it onto the existing
-- `platform` object by ID would silently misattribute policy to the wrong
-- row for the ~half that don't match. Model it as its own object type
-- instead of guessing a name-based join. Aditiva: solo amplia el CHECK.
BEGIN;

ALTER TABLE public.cyberark_inventory_objects
  DROP CONSTRAINT IF EXISTS cyberark_inventory_objects_object_type_check;

ALTER TABLE public.cyberark_inventory_objects
  ADD CONSTRAINT cyberark_inventory_objects_object_type_check
    CHECK (object_type IN (
      'user', 'role', 'safe', 'platform', 'psm', 'access_policy', 'sia',
      'component', 'psm_connector', 'aim_application',
      'platform_dependent', 'platform_group', 'platform_rotational_group',
      'platform_target'
    ));

COMMIT;
