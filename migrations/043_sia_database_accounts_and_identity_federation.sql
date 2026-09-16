-- Migration 043: SIA-STRONG-001 (database strong accounts) and ID-001
-- (Identity Administration federations, core fields only). Both confirmed
-- live against the tenant.
--
-- Database strong accounts get their OWN object_type ('sia_database_account')
-- instead of reusing 'sia_resource' (shared with SIA-RES-001 VMs): the
-- object_type is also the reconciliation scope (see
-- services/cmdb_persistence.reconcile_objects), and an install that only
-- configures CA_SIA_DB_STRONG_ACCOUNTS_PATH (not
-- CA_SIA_VM_INFRASTRUCTURE_PATH, or vice versa) must not have this run
-- retire the other catalog's previously-synced rows just because this run
-- never asked about them.
--
-- 'identity_federation' was already added to this CHECK in migration 041,
-- pending the Domains/Apps/CyberarkServices allowlist decision for ID-001;
-- that decision is now made (core fields only, see
-- services/identity_admin_mapping.py), so no CHECK change is needed for it
-- here — only services/cmdb_models.OBJECT_TYPES gains the entry.
--
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
      'sia_connector', 'sia_resource', 'sia_database_account', 'identity_federation'
    ));

COMMIT;
