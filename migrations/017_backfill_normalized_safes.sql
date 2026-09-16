-- Migration 017: backfill the verified Safe inventory into the normalized CMDB layer.

BEGIN;

INSERT INTO public.cyberark_inventory_objects (
  source_system, object_type, source_id, display_name, lifecycle_status,
  data_quality_status, first_seen_at, last_seen_at, source_run_id, attributes
)
SELECT
  'cyberark', 'safe', s.safe_number::text, s.safe_name, s.lifecycle_status,
  COALESCE(m.data_quality_status, 'pending'), s.first_seen_at, s.last_seen_at,
  s.source_run_id, jsonb_build_object('safe_url_id', s.safe_url_id)
FROM public.safes s
LEFT JOIN public.cyberark_safe_metadata m USING (safe_number)
ON CONFLICT (source_system, object_type, source_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  lifecycle_status = EXCLUDED.lifecycle_status,
  first_seen_at = EXCLUDED.first_seen_at,
  last_seen_at = EXCLUDED.last_seen_at,
  source_run_id = EXCLUDED.source_run_id,
  attributes = EXCLUDED.attributes,
  updated_at = now();

COMMIT;
