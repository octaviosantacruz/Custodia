-- Migration 042: ACCESS-001 left source_system = 'access' on inventory
-- objects (040) but never widened the ingestion-run CHECK from 025.
-- POST /api/ingestion/all/runs therefore fails with CheckViolation when
-- enqueueing the Access space job. Findings share the same allowlist.
-- Aditiva: solo amplia CHECKs existentes.
BEGIN;

ALTER TABLE public.cyberark_ingestion_runs
  DROP CONSTRAINT IF EXISTS cyberark_ingestion_runs_source_system_check;

ALTER TABLE public.cyberark_ingestion_runs
  ADD CONSTRAINT cyberark_ingestion_runs_source_system_check
    CHECK (source_system IN ('cyberark', 'identity_administration', 'sia', 'access'));

ALTER TABLE public.cyberark_findings
  DROP CONSTRAINT IF EXISTS cyberark_findings_source_system_check;

ALTER TABLE public.cyberark_findings
  ADD CONSTRAINT cyberark_findings_source_system_check
    CHECK (source_system IN ('cyberark', 'identity_administration', 'sia', 'access'));

COMMIT;
