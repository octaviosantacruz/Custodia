-- Sanitized application failures for the administrator-facing operations log.
BEGIN;

CREATE TABLE public.operational_error_events (
    event_id BIGSERIAL PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    request_id TEXT NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    error_kind TEXT NOT NULL,
    status_code SMALLINT NOT NULL DEFAULT 500 CHECK (status_code BETWEEN 500 AND 599),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX operational_error_events_occurred_at_idx
    ON public.operational_error_events (occurred_at DESC);
CREATE INDEX operational_error_events_request_id_idx
    ON public.operational_error_events (request_id);

COMMIT;
