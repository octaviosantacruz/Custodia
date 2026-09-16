-- Migration 025: make ingestion history explicit about its source and shape.
-- Existing PAM columns remain for backwards compatibility; generic counters
-- allow Identity Administration and SIA runs to use the same history safely.
BEGIN;

ALTER TABLE public.cyberark_ingestion_runs
  ADD COLUMN IF NOT EXISTS source_system TEXT NOT NULL DEFAULT 'cyberark'
    CHECK (source_system IN ('cyberark', 'identity_administration', 'sia')),
  ADD COLUMN IF NOT EXISTS received_object_count BIGINT NOT NULL DEFAULT 0
    CHECK (received_object_count >= 0),
  ADD COLUMN IF NOT EXISTS received_relationship_count BIGINT NOT NULL DEFAULT 0
    CHECK (received_relationship_count >= 0),
  ADD COLUMN IF NOT EXISTS retired_object_count BIGINT NOT NULL DEFAULT 0
    CHECK (retired_object_count >= 0),
  ADD COLUMN IF NOT EXISTS retired_relationship_count BIGINT NOT NULL DEFAULT 0
    CHECK (retired_relationship_count >= 0);

UPDATE public.cyberark_ingestion_runs
SET received_object_count = received_safe_count,
    received_relationship_count = received_member_count,
    retired_object_count = safes_retired,
    retired_relationship_count = members_retired
WHERE received_object_count = 0
  AND received_relationship_count = 0
  AND (received_safe_count > 0 OR received_member_count > 0);

CREATE INDEX IF NOT EXISTS idx_cyberark_ingestion_runs_source_started
  ON public.cyberark_ingestion_runs (source_system, started_at DESC);

COMMIT;
