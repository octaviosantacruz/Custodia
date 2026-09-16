-- Migration 024: per-run change breakdown for the sync history.
--
-- cyberark_ingestion_runs already records how many safes/members were
-- received and how many errors occurred, but not how the inventory moved
-- (created vs updated vs retired) nor who started the run. run_ingestion
-- already computes these numbers per entry (ingest_entry returns
-- safe_inserted / members_inserted / members_updated, reconcile_inventory
-- returns the retired counts) and simply discards them. These columns let
-- the history panel show a real diff over time. All nullable / default 0 so
-- existing rows and the auto-baseline stay valid.
BEGIN;

ALTER TABLE public.cyberark_ingestion_runs
  ADD COLUMN IF NOT EXISTS triggered_by      TEXT,
  ADD COLUMN IF NOT EXISTS safes_created     INTEGER NOT NULL DEFAULT 0 CHECK (safes_created   >= 0),
  ADD COLUMN IF NOT EXISTS safes_updated     INTEGER NOT NULL DEFAULT 0 CHECK (safes_updated   >= 0),
  ADD COLUMN IF NOT EXISTS safes_retired     INTEGER NOT NULL DEFAULT 0 CHECK (safes_retired   >= 0),
  ADD COLUMN IF NOT EXISTS members_created   INTEGER NOT NULL DEFAULT 0 CHECK (members_created >= 0),
  ADD COLUMN IF NOT EXISTS members_updated   INTEGER NOT NULL DEFAULT 0 CHECK (members_updated >= 0),
  ADD COLUMN IF NOT EXISTS members_retired   INTEGER NOT NULL DEFAULT 0 CHECK (members_retired >= 0),
  ADD COLUMN IF NOT EXISTS pam_synced        BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
