-- NSK-REF-001: the user total Netskope itself reports (users/counts) when an inventory run reads its users.
-- It is a reference to compare with the identities DS Hub lists from getusers, a different count of the same
-- tenant; it never feeds a KPI or a reconciliation. One row per run, written only after the inventory landed.
BEGIN;

CREATE TABLE IF NOT EXISTS public.netskope_reported_counts (
    source_run_id UUID PRIMARY KEY REFERENCES public.cyberark_ingestion_runs(run_id),
    total_users INTEGER NOT NULL CHECK (total_users >= 0),
    -- lastModified as Netskope reports it: when its own aggregate was computed.
    reported_at TIMESTAMPTZ,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
