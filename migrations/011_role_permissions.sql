-- Migration 011: explicit permissions for authenticated application actors.
BEGIN;

CREATE TABLE IF NOT EXISTS public.access_role_permissions (
  role_code       TEXT NOT NULL REFERENCES public.access_roles(role_code),
  permission_code TEXT NOT NULL,
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (role_code, permission_code)
);

INSERT INTO public.access_role_permissions (role_code, permission_code) VALUES
  ('reader', 'inventory:read'),
  ('operator', 'inventory:read'),
  ('operator', 'inventory:write'),
  ('operator', 'catalogs:read'),
  ('admin', 'inventory:read'),
  ('admin', 'inventory:write'),
  ('admin', 'catalogs:read'),
  ('admin', 'catalogs:write'),
  ('admin', 'access:manage')
ON CONFLICT (role_code, permission_code) DO NOTHING;

INSERT INTO public.access_user_roles (actor_id, role_code, granted_by)
VALUES ('local-admin', 'admin', 'system')
ON CONFLICT (actor_id, role_code) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_access_role_permissions_permission
  ON public.access_role_permissions (permission_code);

COMMIT;
