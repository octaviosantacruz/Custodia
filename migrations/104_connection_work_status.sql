-- Migration 104: COV-004. Each destination carries a work state, a responsible and a note, set by people. They live
-- on the inventory row and an import never resets them: only a file that carries the column overrides the value.
BEGIN;

ALTER TABLE public.connection_inventory
  ADD COLUMN IF NOT EXISTS work_status TEXT NOT NULL DEFAULT 'pending'
    CONSTRAINT connection_inventory_work_status_check CHECK (work_status IN ('pending', 'in_progress', 'onboarded', 'blocked', 'not_applicable')),
  ADD COLUMN IF NOT EXISTS responsible TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';

COMMIT;
