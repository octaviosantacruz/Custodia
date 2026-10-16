-- Link lightweight synchronization events to the exact durable ingestion run.
--
-- The event stream is intentionally payload-free, but observers need these
-- references to request the correct terminal result when sources finish in
-- parallel.
BEGIN;

ALTER TABLE public.activity_events
  ADD COLUMN IF NOT EXISTS run_id UUID NULL,
  ADD COLUMN IF NOT EXISTS source_system TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_activity_events_run_id
  ON public.activity_events (run_id)
  WHERE run_id IS NOT NULL;

COMMIT;
