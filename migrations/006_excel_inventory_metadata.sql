-- Migration 006: preserve the legacy account-inventory classification.
-- These fields are imported reference data; web workflow fields remain separate.
BEGIN;

ALTER TABLE public.cyberark_safe_metadata
  ADD COLUMN IF NOT EXISTS inventory_status TEXT,
  ADD COLUMN IF NOT EXISTS inventory_action TEXT,
  ADD COLUMN IF NOT EXISTS inventory_responsible TEXT,
  ADD COLUMN IF NOT EXISTS inventory_notes TEXT,
  ADD COLUMN IF NOT EXISTS inventory_account_count INTEGER NOT NULL DEFAULT 0
    CHECK (inventory_account_count >= 0),
  ADD COLUMN IF NOT EXISTS inventory_platforms JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS inventory_status_conflict BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS inventory_imported_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inventory_source_file TEXT;

CREATE INDEX IF NOT EXISTS idx_cyberark_safe_metadata_inventory_status
  ON public.cyberark_safe_metadata (inventory_status);

CREATE TABLE IF NOT EXISTS public.cyberark_inventory_imports (
  import_id             UUID PRIMARY KEY,
  source_file           TEXT NOT NULL,
  source_sheet          TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  imported_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_row_count      INTEGER NOT NULL CHECK (source_row_count >= 0),
  source_safe_count     INTEGER NOT NULL CHECK (source_safe_count >= 0),
  matched_safe_count    INTEGER NOT NULL CHECK (matched_safe_count >= 0),
  unmatched_safe_count  INTEGER NOT NULL CHECK (unmatched_safe_count >= 0),
  conflict_safe_count   INTEGER NOT NULL CHECK (conflict_safe_count >= 0),
  details               JSONB NOT NULL DEFAULT '{}'::jsonb
);

COMMIT;
