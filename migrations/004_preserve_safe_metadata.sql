-- Preserve web-managed classification when a safe is absent from a later
-- complete CyberArk snapshot and staging reconciliation removes that safe.
BEGIN;

ALTER TABLE cyberark_safe_metadata
  DROP CONSTRAINT IF EXISTS cyberark_safe_metadata_safe_number_fkey;

COMMIT;
