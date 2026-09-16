-- Migration 013: normalize CyberArk empty/root locations.

BEGIN;

UPDATE public.safes
SET location = NULL
WHERE location IS NOT NULL
  AND btrim(location) IN ('', E'\\');

COMMIT;
