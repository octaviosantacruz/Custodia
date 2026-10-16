-- Keep the allowlisted Netskope device state observed in each completed sync.
-- This is history only; the current CMDB row remains the read-optimized index.
BEGIN;

CREATE TABLE public.netskope_device_snapshots (
    snapshot_id BIGSERIAL PRIMARY KEY,
    source_run_id UUID NOT NULL REFERENCES public.cyberark_ingestion_runs(run_id),
    device_id TEXT NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    attributes JSONB NOT NULL,
    UNIQUE (source_run_id, device_id)
);

CREATE INDEX netskope_device_snapshots_device_idx
    ON public.netskope_device_snapshots (device_id, captured_at DESC, snapshot_id DESC);

COMMIT;
