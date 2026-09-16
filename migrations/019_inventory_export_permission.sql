-- Migration 019: CSV exports are restricted to application administrators.
BEGIN;

INSERT INTO public.access_role_permissions (role_code, permission_code)
VALUES ('admin', 'inventory:export')
ON CONFLICT (role_code, permission_code) DO NOTHING;

COMMIT;
