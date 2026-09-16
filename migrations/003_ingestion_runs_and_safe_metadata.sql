-- Migration 003: ingestion history and web-managed safe metadata.
-- CyberArk data and manual classification live in separate tables.

BEGIN;

CREATE TABLE cyberark_ingestion_runs (
  run_id                UUID PRIMARY KEY,
  source_file           TEXT,
  status                TEXT NOT NULL CHECK (status IN ('running', 'completed', 'partial', 'failed')),
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at          TIMESTAMPTZ,
  expected_safe_count   INTEGER CHECK (expected_safe_count IS NULL OR expected_safe_count >= 0),
  received_safe_count   INTEGER NOT NULL DEFAULT 0 CHECK (received_safe_count >= 0),
  received_member_count BIGINT NOT NULL DEFAULT 0 CHECK (received_member_count >= 0),
  error_count           INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  error_details         JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Register existing raw runs before adding foreign keys.
INSERT INTO cyberark_ingestion_runs (
  run_id,
  source_file,
  status,
  started_at,
  completed_at,
  received_safe_count,
  received_member_count,
  error_count,
  error_details
)
SELECT
  source_run_id,
  NULL,
  'completed',
  min(ingested_at),
  max(ingested_at),
  count(*)::integer,
  coalesce(sum(jsonb_array_length(raw_payload->'members')), 0)::bigint,
  0,
  '[]'::jsonb
FROM raw_safe_members_dump
GROUP BY source_run_id
ON CONFLICT (run_id) DO NOTHING;

ALTER TABLE raw_safe_members_dump
  ADD CONSTRAINT raw_safe_members_dump_source_run_id_fkey
  FOREIGN KEY (source_run_id) REFERENCES cyberark_ingestion_runs(run_id);

ALTER TABLE safes
  ALTER COLUMN source_run_id SET NOT NULL;

ALTER TABLE safe_members
  ALTER COLUMN source_run_id SET NOT NULL;

ALTER TABLE safes
  ADD CONSTRAINT safes_source_run_id_fkey
  FOREIGN KEY (source_run_id) REFERENCES cyberark_ingestion_runs(run_id);

ALTER TABLE safe_members
  ADD CONSTRAINT safe_members_source_run_id_fkey
  FOREIGN KEY (source_run_id) REFERENCES cyberark_ingestion_runs(run_id);

CREATE INDEX idx_raw_safe_members_dump_source_run_id
  ON raw_safe_members_dump (source_run_id);

CREATE TABLE cyberark_business_units (
  business_unit_id BIGSERIAL PRIMARY KEY,
  unit_code        TEXT NOT NULL UNIQUE,
  unit_name        TEXT NOT NULL UNIQUE,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cyberark_responsibles (
  responsible_id BIGSERIAL PRIMARY KEY,
  display_name   TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cyberark_safe_metadata (
  safe_number          INTEGER PRIMARY KEY,
  internal_name        TEXT,
  business_unit_id     BIGINT REFERENCES cyberark_business_units(business_unit_id),
  responsible_id       BIGINT REFERENCES cyberark_responsibles(responsible_id),
  classification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (classification_status IN ('pending', 'assigned', 'review')),
  notes                TEXT,
  assigned_at          TIMESTAMPTZ,
  assigned_by          TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO cyberark_safe_metadata (safe_number)
SELECT safe_number FROM safes
ON CONFLICT (safe_number) DO NOTHING;

CREATE INDEX idx_cyberark_safe_metadata_business_unit
  ON cyberark_safe_metadata (business_unit_id);

CREATE INDEX idx_cyberark_safe_metadata_responsible
  ON cyberark_safe_metadata (responsible_id);

COMMIT;
