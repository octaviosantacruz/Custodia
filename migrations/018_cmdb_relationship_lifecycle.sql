-- Migration 018: retain normalized CMDB relationships after they disappear from a complete source snapshot.

BEGIN;

ALTER TABLE public.cyberark_inventory_relationships
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('active', 'retired')),
  ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_inventory_relationships_status
  ON public.cyberark_inventory_relationships (relationship_type, lifecycle_status);

COMMIT;
