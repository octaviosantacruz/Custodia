-- Migration 034: lightweight cross-session refresh events.
--
-- Events contain no inventory payload. Clients use them only to detect a
-- completed sync, import, or human classification and refresh their current
-- workspace.
BEGIN;

CREATE TABLE IF NOT EXISTS public.activity_events (
  event_id    BIGSERIAL PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('sync', 'import', 'classification')),
  actor_id    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_events_created
  ON public.activity_events (event_id);

COMMIT;
