-- Migration 001: raw + staging layers for CyberArk Safes and Safe Members
-- Source: CyberArk Privilege Cloud API, format documented in safes_members_findings.md

-- ============================================================
-- CAPA RAW (append-only, nunca UPDATE)
-- ============================================================

CREATE TABLE raw_safe_members_dump (
  id              BIGSERIAL PRIMARY KEY,
  source_run_id   UUID NOT NULL,
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  safe_name       TEXT NOT NULL,
  raw_payload     JSONB NOT NULL
);

-- ============================================================
-- CAPA STAGING (upsert, estado actual resuelto)
-- ============================================================

CREATE OR REPLACE FUNCTION epoch_to_timestamptz(raw BIGINT) RETURNS TIMESTAMPTZ AS $$
  SELECT CASE
    WHEN raw > 100000000000000 THEN to_timestamp(raw / 1000000.0)
    ELSE to_timestamp(raw)
  END;
$$ LANGUAGE SQL IMMUTABLE;

CREATE TABLE safes (
  safe_number                    INT PRIMARY KEY,
  safe_name                      TEXT NOT NULL,
  safe_url_id                    TEXT NOT NULL UNIQUE,
  location                       TEXT,
  creator_id                     TEXT,
  creator_name                   TEXT,
  olac_enabled                   BOOLEAN,
  number_of_versions_retention   INT,
  number_of_days_retention       INT,
  auto_purge_enabled             BOOLEAN,
  creation_time                  TIMESTAMPTZ,
  last_modification_time         TIMESTAMPTZ,
  description                    TEXT,
  managing_cpm                   TEXT,
  is_expired_member              BOOLEAN,
  first_seen_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_run_id                  UUID
);

CREATE TABLE safe_members (
  id                              BIGSERIAL PRIMARY KEY,
  safe_number                     INT NOT NULL REFERENCES safes(safe_number),
  member_id                       TEXT NOT NULL,
  member_name                     TEXT NOT NULL,
  member_type                     TEXT NOT NULL,
  membership_expiration_date      TIMESTAMPTZ,
  is_expired_membership_enable    BOOLEAN,
  is_predefined_user              BOOLEAN,
  is_read_only                    BOOLEAN,
  permissions                     JSONB NOT NULL,
  first_seen_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_run_id                   UUID,
  UNIQUE (safe_number, member_id)
);

CREATE INDEX idx_safe_members_permissions ON safe_members USING GIN (permissions);
CREATE INDEX idx_safe_members_member_id   ON safe_members (member_id);
CREATE INDEX idx_safe_members_type        ON safe_members (member_type);
