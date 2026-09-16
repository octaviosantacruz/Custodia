-- Migration 026: versioned, evidence-backed posture findings.
-- Findings are derived from persisted CyberArk inventory; no secrets or raw
-- provider payloads are stored.
BEGIN;

CREATE TABLE IF NOT EXISTS public.cyberark_findings (
  finding_id         BIGSERIAL PRIMARY KEY,
  rule_id            TEXT NOT NULL,
  rule_version       TEXT NOT NULL,
  source_system      TEXT NOT NULL DEFAULT 'cyberark'
                     CHECK (source_system IN ('cyberark', 'identity_administration', 'sia')),
  subject_type       TEXT NOT NULL,
  subject_id         TEXT NOT NULL,
  title              TEXT NOT NULL,
  severity           TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  category           TEXT NOT NULL CHECK (category IN ('review', 'non_compliance', 'data_quality')),
  status             TEXT NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open', 'acknowledged', 'resolved', 'excepted')),
  evidence           JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_run_id      UUID REFERENCES public.cyberark_ingestion_runs(run_id),
  first_detected_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_detected_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at        TIMESTAMPTZ,
  exception_reason   TEXT,
  exception_until    TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rule_id, rule_version, source_system, subject_type, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_cyberark_findings_status
  ON public.cyberark_findings (status, severity, last_detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_cyberark_findings_subject
  ON public.cyberark_findings (subject_type, subject_id);

COMMIT;
