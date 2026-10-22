-- Migration 110: the product is now Custodia. Earlier migrations stay immutable, so the catalog texts they seeded with
-- the old name are updated here.
BEGIN;

UPDATE public.access_permissions
   SET description = replace(description, 'DS Hub', 'Custodia')
 WHERE permission_code IN ('access:manage', 'domain:admin')
   AND description LIKE '%DS Hub%';

COMMENT ON SCHEMA reporting IS 'Explicit operational read models; PostgreSQL grants do not inherit Custodia permissions.';

COMMIT;
