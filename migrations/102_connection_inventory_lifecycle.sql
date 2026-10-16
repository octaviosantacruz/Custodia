-- Migration 102: COV-002. The destination inventory import now updates and adds by IP + port; a row missing from the
-- file is kept as `retired` (never deleted). Every import still writes a full snapshot, so earlier ones stay readable.
BEGIN;

ALTER TABLE public.connection_inventory
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'active'
    CONSTRAINT connection_inventory_lifecycle_check CHECK (lifecycle_status IN ('active', 'retired')),
  ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ;

ALTER TABLE public.connection_inventory_imports
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'replace'
    CONSTRAINT connection_inventory_imports_mode_check CHECK (mode IN ('replace', 'update')),
  ADD COLUMN IF NOT EXISTS summary JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_connection_inventory_import_lifecycle
  ON public.connection_inventory (import_id, lifecycle_status);

COMMIT;
