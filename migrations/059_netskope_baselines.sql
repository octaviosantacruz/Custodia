-- NSK-VER-001 / NSK-FLT-001: compliance baselines for the Netskope inventory.
-- An admin sets them explicitly; they are never inferred from the most common
-- value or downloaded. Each change is audited in access_audit_log (who, when,
-- before/after); this table only keeps the current value.
BEGIN;

CREATE TABLE public.netskope_baselines (
    baseline_key TEXT PRIMARY KEY
        CHECK (baseline_key IN ('client_golden_releases', 'os_minimum_versions')),
    -- client_golden_releases: {"releases": ["141.0.0", "138.1.0", ...]} newest first.
    -- os_minimum_versions: {"minimums": {"Windows": "10.0.19045", "Mac": "15.0.0"}}.
    value JSONB NOT NULL,
    note TEXT CHECK (note IS NULL OR length(note) <= 500),
    updated_by TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
