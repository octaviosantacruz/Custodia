-- Migration 105: COV-005. One snapshot of the destination-coverage counts per day (the last of the day wins), taken after
-- a sync that feeds the coverage and after an import, so the weekly trend can be reproduced from what was recorded.
BEGIN;

CREATE TABLE IF NOT EXISTS public.connection_coverage_snapshots (
  snapshot_date DATE PRIMARY KEY,
  captured_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  trigger       TEXT NOT NULL CHECK (trigger IN ('sync', 'import', 'manual')),
  counts        JSONB NOT NULL
);

COMMIT;
