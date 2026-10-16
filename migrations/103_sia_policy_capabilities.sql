-- Migration 103: COV-003. A person classifies each SIA access policy as Platform, DBA or other so the destination
-- inventory can compare what the sheet declares per capability with what SIA observes. It references the policy by
-- its SIA id, so a sync never overwrites it; nothing is inferred from the policy name or rules.
BEGIN;

CREATE TABLE IF NOT EXISTS public.sia_policy_capabilities (
  policy_source_id TEXT PRIMARY KEY,
  capability       TEXT NOT NULL CHECK (capability IN ('platform', 'dba', 'other')),
  classified_by    TEXT NOT NULL,
  classified_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
