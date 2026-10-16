-- NSK-GRP-001: Netskope groups share the Netskope source but remain a distinct
-- inventory type; membership is stored as `member_of` relationships.
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
      'device', 'dem_site', 'netskope_group'
    ));

COMMIT;
