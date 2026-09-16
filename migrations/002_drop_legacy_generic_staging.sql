-- Remove the obsolete generic test staging tables.
-- staging_record depends on ingestion_snapshot, so drop it first.
BEGIN;

DROP TABLE IF EXISTS public.staging_record;
DROP TABLE IF EXISTS public.ingestion_snapshot;

COMMIT;
