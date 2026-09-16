-- Migration 015: explicit KR1 scope and data-quality classification for Safes.
-- These fields are intentionally manual/preserved across ingestion.

BEGIN;

ALTER TABLE public.cyberark_safe_metadata
  ADD COLUMN IF NOT EXISTS inventory_scope TEXT NOT NULL DEFAULT 'pending'
    CHECK (inventory_scope IN ('pending', 'business', 'internal')),
  ADD COLUMN IF NOT EXISTS data_quality_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (data_quality_status IN ('pending', 'clean', 'obsolete', 'duplicate'));

CREATE INDEX IF NOT EXISTS idx_cyberark_safe_metadata_inventory_scope
  ON public.cyberark_safe_metadata (inventory_scope);
CREATE INDEX IF NOT EXISTS idx_cyberark_safe_metadata_data_quality
  ON public.cyberark_safe_metadata (data_quality_status);

COMMIT;
