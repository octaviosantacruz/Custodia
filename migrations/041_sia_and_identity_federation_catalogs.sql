-- Migration 041: SIA-CONN-001 (connectors), SIA-RES-001 (VM infrastructure)
-- and ID-001 (Identity Administration federations). All three confirmed
-- live against the tenant (2026-09-11) reusing already-authorized
-- credentials -- no new object_type space needed beyond widening the CHECK.
-- Aditiva: solo amplia el CHECK.
BEGIN;

ALTER TABLE public.cyberark_inventory_objects
  DROP CONSTRAINT IF EXISTS cyberark_inventory_objects_object_type_check;

ALTER TABLE public.cyberark_inventory_objects
  ADD CONSTRAINT cyberark_inventory_objects_object_type_check
    CHECK (object_type IN (
      'user', 'role', 'safe', 'platform', 'psm', 'access_policy', 'sia',
      'component', 'psm_connector', 'aim_application',
      'platform_dependent', 'platform_group', 'platform_rotational_group',
      'platform_target', 'access_asset',
      'sia_connector', 'sia_resource', 'identity_federation'
    ));

COMMIT;
