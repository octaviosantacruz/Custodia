-- Migration 016: normalized object and relationship layer for KR1 PAM/SIA chains.
-- This is separate from raw/staging Safes and is populated only by verified API ingestors.

BEGIN;

CREATE TABLE IF NOT EXISTS public.cyberark_inventory_objects (
  object_id             BIGSERIAL PRIMARY KEY,
  source_system         TEXT NOT NULL DEFAULT 'cyberark',
  object_type           TEXT NOT NULL CHECK (object_type IN (
    'user', 'role', 'safe', 'platform', 'psm', 'access_policy', 'sia'
  )),
  source_id             TEXT NOT NULL,
  display_name          TEXT NOT NULL,
  lifecycle_status      TEXT NOT NULL DEFAULT 'active'
                         CHECK (lifecycle_status IN ('active', 'retired')),
  data_quality_status   TEXT NOT NULL DEFAULT 'pending'
                         CHECK (data_quality_status IN ('pending', 'clean', 'obsolete', 'duplicate')),
  first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_run_id         UUID,
  attributes            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_system, object_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_objects_type_status
  ON public.cyberark_inventory_objects (object_type, lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_inventory_objects_quality
  ON public.cyberark_inventory_objects (data_quality_status);
CREATE INDEX IF NOT EXISTS idx_inventory_objects_name
  ON public.cyberark_inventory_objects (lower(display_name));
CREATE INDEX IF NOT EXISTS idx_inventory_objects_attributes
  ON public.cyberark_inventory_objects USING GIN (attributes);

CREATE TABLE IF NOT EXISTS public.cyberark_inventory_relationships (
  relationship_id      BIGSERIAL PRIMARY KEY,
  source_object_id     BIGINT NOT NULL REFERENCES public.cyberark_inventory_objects(object_id),
  target_object_id     BIGINT NOT NULL REFERENCES public.cyberark_inventory_objects(object_id),
  relationship_type    TEXT NOT NULL,
  first_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_run_id        UUID,
  attributes           JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (source_object_id, target_object_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_inventory_relationships_source
  ON public.cyberark_inventory_relationships (source_object_id, relationship_type);
CREATE INDEX IF NOT EXISTS idx_inventory_relationships_target
  ON public.cyberark_inventory_relationships (target_object_id, relationship_type);

COMMIT;
