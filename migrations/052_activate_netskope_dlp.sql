-- Migration 052: activate the DS Hub Netskope DLP workspace and its role catalog.
-- This enables local navigation and authorization only; it does not configure
-- a Netskope API client, credentials, endpoints, or data synchronization.
BEGIN;

UPDATE public.access_domains
SET lifecycle_status = 'active'
WHERE domain_code = 'dlp';

UPDATE public.access_permissions
SET lifecycle_status = 'active'
WHERE permission_code IN ('domain:dlp', 'netskope:read', 'netskope:admin');

UPDATE public.access_roles
SET lifecycle_status = 'active',
    description = CASE role_code
      WHEN 'netskope_reader' THEN 'Lectura del espacio Netskope DLP'
      WHEN 'netskope_admin' THEN 'Administración del espacio Netskope DLP'
      ELSE description
    END
WHERE role_code IN ('netskope_reader', 'netskope_admin');

COMMIT;
