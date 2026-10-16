-- Cache sanitario de eventos DLP recientes para investigación contextual.
-- No guarda payloads, archivos, IPs, URLs ni campos forenses.
BEGIN;

CREATE TABLE public.netskope_dlp_event_cache (
    event_id TEXT PRIMARY KEY,
    event_timestamp TIMESTAMPTZ NOT NULL,
    alert_name TEXT NOT NULL DEFAULT '',
    alert_type TEXT NOT NULL DEFAULT '',
    app TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL DEFAULT '',
    severity TEXT NOT NULL DEFAULT '',
    hostname TEXT NOT NULL DEFAULT '',
    violating_user TEXT NOT NULL DEFAULT '',
    dlp_incident_id TEXT,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.netskope_dlp_cache_state (
    cache_key TEXT PRIMARY KEY CHECK (cache_key = 'default'),
    window_start TIMESTAMPTZ NOT NULL,
    window_end TIMESTAMPTZ NOT NULL,
    scanned_events INTEGER NOT NULL CHECK (scanned_events >= 0),
    scanned_pages INTEGER NOT NULL CHECK (scanned_pages >= 0),
    partial BOOLEAN NOT NULL DEFAULT false,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX netskope_dlp_event_cache_time_idx
    ON public.netskope_dlp_event_cache (event_timestamp DESC, event_id);

CREATE INDEX netskope_dlp_event_cache_user_idx
    ON public.netskope_dlp_event_cache (lower(violating_user), event_timestamp DESC);

CREATE INDEX netskope_dlp_event_cache_hostname_idx
    ON public.netskope_dlp_event_cache (hostname, event_timestamp DESC);

COMMIT;
