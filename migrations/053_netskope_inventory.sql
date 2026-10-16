-- Netskope CMDB inventory: isolated users and endpoint devices.
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
      'sia_database_account', 'identity_federation', 'device'
    ));

ALTER TABLE public.cyberark_ingestion_runs
  DROP CONSTRAINT IF EXISTS cyberark_ingestion_runs_source_system_check;

ALTER TABLE public.cyberark_ingestion_runs
  ADD CONSTRAINT cyberark_ingestion_runs_source_system_check
    CHECK (source_system IN ('cyberark', 'identity_administration', 'sia', 'access', 'netskope'));

ALTER TABLE public.cyberark_findings
  DROP CONSTRAINT IF EXISTS cyberark_findings_source_system_check;

ALTER TABLE public.cyberark_findings
  ADD CONSTRAINT cyberark_findings_source_system_check
    CHECK (source_system IN ('cyberark', 'identity_administration', 'sia', 'access', 'netskope'));

COMMIT;
