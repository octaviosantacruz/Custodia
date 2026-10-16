-- NSK-ALR-001: count-only Netskope alert snapshots for bounded rolling windows.
-- No event rows, users, IPs, URLs, filenames or forensic payloads are stored.
BEGIN;

CREATE TABLE public.netskope_alert_aggregates (
    aggregate_id BIGSERIAL PRIMARY KEY,
    source_run_id UUID NOT NULL REFERENCES public.cyberark_ingestion_runs(run_id),
    window_days SMALLINT NOT NULL CHECK (window_days IN (7, 30, 90)),
    window_start TIMESTAMPTZ NOT NULL,
    window_end TIMESTAMPTZ NOT NULL,
    dimension TEXT NOT NULL CHECK (dimension IN ('total', 'alert_type', 'severity', 'action')),
    dimension_value TEXT NOT NULL DEFAULT '',
    alert_count BIGINT NOT NULL CHECK (alert_count >= 0),
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT netskope_alert_aggregate_key UNIQUE (source_run_id, window_days, dimension, dimension_value),
    CONSTRAINT netskope_alert_aggregate_dimension_value CHECK (
        (dimension = 'total' AND dimension_value = '')
        OR (dimension <> 'total' AND dimension_value <> '')
    ),
    CONSTRAINT netskope_alert_aggregate_window CHECK (window_start < window_end)
);

CREATE INDEX netskope_alert_aggregates_latest_idx
    ON public.netskope_alert_aggregates (window_days, dimension, captured_at DESC, aggregate_id DESC);

COMMIT;
