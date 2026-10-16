-- SYNC-UI-002: administrator-managed cadence overrides per scheduled task.
BEGIN;

CREATE TABLE public.sync_schedule_overrides (
  task_key TEXT PRIMARY KEY CHECK (btrim(task_key) <> ''),
  interval_minutes NUMERIC NOT NULL CHECK (interval_minutes = 0 OR interval_minutes >= 5),
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
