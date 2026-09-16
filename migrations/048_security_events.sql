-- Migration 048: durable authentication/security events (PENTEST-008).
BEGIN;

CREATE TABLE IF NOT EXISTS public.access_security_events (
    event_id BIGSERIAL PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    event_type TEXT NOT NULL,
    actor_id TEXT,
    result TEXT NOT NULL CHECK (result IN ('success', 'failure')),
    source_ip TEXT,
    request_id TEXT,
    mechanism TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS access_security_events_occurred_at_idx
    ON public.access_security_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS access_security_events_event_type_idx
    ON public.access_security_events (event_type);
CREATE INDEX IF NOT EXISTS access_security_events_actor_id_idx
    ON public.access_security_events (actor_id);

COMMIT;
