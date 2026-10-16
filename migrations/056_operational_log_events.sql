-- Structured, sanitized events for the administrator-facing operations log.
BEGIN;

CREATE TABLE public.operational_log_events (
    log_id BIGSERIAL PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    level TEXT NOT NULL CHECK (level IN ('info', 'warning', 'error')),
    source_system TEXT NOT NULL,
    event TEXT NOT NULL,
    message TEXT NOT NULL,
    run_id UUID NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX operational_log_events_occurred_at_idx
    ON public.operational_log_events (occurred_at DESC, log_id DESC);
CREATE INDEX operational_log_events_source_idx
    ON public.operational_log_events (source_system, occurred_at DESC);
CREATE INDEX operational_log_events_run_idx
    ON public.operational_log_events (run_id);

COMMIT;
