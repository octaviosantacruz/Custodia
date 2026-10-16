-- SYNC-TASK-001: scheduler task identity, separate from data ownership.
-- source_system keeps meaning "whose data is this"; task_key says "which
-- scheduled job produced the run". Historical runs keep their behavior:
-- every source maps to itself, except the former combined Netskope run, which
-- was the inventory job.
BEGIN;

ALTER TABLE public.cyberark_ingestion_runs ADD COLUMN task_key TEXT;

UPDATE public.cyberark_ingestion_runs
SET task_key = CASE WHEN source_system = 'netskope' THEN 'netskope_inventory' ELSE source_system END
WHERE task_key IS NULL;

-- Producers that do not name a task (PAM's pipeline, tests, scripts) default
-- to their source, which preserves the one-task-per-source semantics.
CREATE FUNCTION public.default_ingestion_run_task_key() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.task_key IS NULL THEN
    NEW.task_key := NEW.source_system;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ingestion_runs_default_task_key
  BEFORE INSERT ON public.cyberark_ingestion_runs
  FOR EACH ROW EXECUTE FUNCTION public.default_ingestion_run_task_key();

ALTER TABLE public.cyberark_ingestion_runs
  ALTER COLUMN task_key SET NOT NULL,
  ADD CONSTRAINT cyberark_ingestion_runs_task_key_not_blank CHECK (btrim(task_key) <> '');

CREATE INDEX idx_ingestion_runs_task_status_enqueued
  ON public.cyberark_ingestion_runs (task_key, status, enqueued_at);

COMMIT;
