-- Migration 037: durable, observable queue state for source-isolated sync runs.
-- Reuses cyberark_ingestion_runs as the job record; run_id remains the source-run ID.
BEGIN;

ALTER TABLE public.cyberark_ingestion_runs
  DROP CONSTRAINT IF EXISTS cyberark_ingestion_runs_status_check;

ALTER TABLE public.cyberark_ingestion_runs
  ADD CONSTRAINT cyberark_ingestion_runs_status_check
    CHECK (status IN ('queued', 'running', 'completed', 'partial', 'failed'));

ALTER TABLE public.cyberark_ingestion_runs
  ADD COLUMN IF NOT EXISTS enqueued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS run_options JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS stage TEXT,
  ADD COLUMN IF NOT EXISTS progress_current BIGINT NOT NULL DEFAULT 0
    CHECK (progress_current >= 0),
  ADD COLUMN IF NOT EXISTS progress_total BIGINT
    CHECK (progress_total IS NULL OR progress_total >= 0),
  ADD COLUMN IF NOT EXISTS status_message TEXT,
  ADD COLUMN IF NOT EXISTS attempt_count SMALLINT NOT NULL DEFAULT 0
    CHECK (attempt_count >= 0),
  ADD COLUMN IF NOT EXISTS worker_id TEXT,
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS idempotency_key UUID;

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_queue_dispatch
  ON public.cyberark_ingestion_runs (status, enqueued_at)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_source_queue_dispatch
  ON public.cyberark_ingestion_runs (source_system, status, enqueued_at)
  WHERE status = 'queued';

CREATE UNIQUE INDEX IF NOT EXISTS idx_ingestion_runs_actor_idempotency
  ON public.cyberark_ingestion_runs (triggered_by, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMIT;
