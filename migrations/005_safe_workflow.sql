-- Migration 005: operational workflow fields for safe inventory.
-- These fields are web-managed and are never overwritten by CyberArk ingestion.

BEGIN;

ALTER TABLE public.cyberark_safe_metadata
  ADD COLUMN IF NOT EXISTS workflow_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (workflow_status IN ('pending', 'in_progress', 'blocked', 'resolved', 'retired')),
  ADD COLUMN IF NOT EXISTS next_action TEXT;

CREATE INDEX IF NOT EXISTS idx_cyberark_safe_metadata_workflow_status
  ON public.cyberark_safe_metadata (workflow_status);

CREATE INDEX IF NOT EXISTS idx_cyberark_safe_metadata_next_action
  ON public.cyberark_safe_metadata (next_action);

COMMIT;
