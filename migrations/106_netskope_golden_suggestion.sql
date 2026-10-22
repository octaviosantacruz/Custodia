-- Migration 106: NSK-GOLDEN-001. Last golden release pair read from the public Netskope documentation. It is only a
-- suggestion: it never changes netskope_baselines (an admin confirms it through the existing audited PUT).
BEGIN;

CREATE TABLE IF NOT EXISTS public.netskope_golden_suggestion (
  singleton   BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  releases    JSONB NOT NULL,
  source_url  TEXT NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_run_id UUID
);

COMMIT;
