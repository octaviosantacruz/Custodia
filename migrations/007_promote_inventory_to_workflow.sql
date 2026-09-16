-- Migration 007: promote imported inventory values to canonical workflow fields.
-- The XLSX importer was a one-time migration tool. Keep source columns for
-- traceability, but use the canonical web-managed fields from now on.
--
-- Mapping:
--   OK                 -> resolved / assigned
--   A definir          -> blocked / review
--   Pendiente SIA      -> in_progress / assigned
--   Pendiente Rotacion -> in_progress / assigned
--   Baja Pendiente     -> in_progress / assigned
--
-- Only matched, non-conflicting rows are promoted. Safes without a match keep
-- their existing default values.

BEGIN;

UPDATE public.cyberark_safe_metadata
SET
  workflow_status = CASE inventory_status
    WHEN 'OK' THEN 'resolved'
    WHEN 'A definir' THEN 'blocked'
    WHEN 'Pendiente SIA' THEN 'in_progress'
    WHEN 'Pendiente Rotación' THEN 'in_progress'
    WHEN 'Baja Pendiente' THEN 'in_progress'
    ELSE workflow_status
  END,
  classification_status = CASE
    WHEN inventory_status = 'A definir' THEN 'review'
    WHEN inventory_status IN ('OK', 'Pendiente SIA', 'Pendiente Rotación', 'Baja Pendiente')
      THEN 'assigned'
    ELSE classification_status
  END,
  next_action = COALESCE(NULLIF(BTRIM(inventory_action), ''), next_action),
  notes = COALESCE(NULLIF(BTRIM(notes), ''), NULLIF(BTRIM(inventory_notes), '')),
  assigned_at = COALESCE(assigned_at, inventory_imported_at),
  updated_at = now()
WHERE inventory_status IS NOT NULL
  AND inventory_status_conflict = false;

COMMIT;
