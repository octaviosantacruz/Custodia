-- Migration 010: authorization and audit foundation for manual inventory changes.
-- Authentication is intentionally outside this migration; actor_id must come
-- from the authenticated application identity when access control is enabled.

BEGIN;

CREATE TABLE IF NOT EXISTS public.access_roles (
  role_code TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.access_roles (role_code, description) VALUES
  ('reader', 'Puede consultar el inventario'),
  ('operator', 'Puede clasificar y asignar safes'),
  ('admin', 'Puede administrar catálogos, bajas y permisos')
ON CONFLICT (role_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.access_user_roles (
  actor_id TEXT NOT NULL,
  role_code TEXT NOT NULL REFERENCES public.access_roles(role_code),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by TEXT,
  PRIMARY KEY (actor_id, role_code)
);

CREATE TABLE IF NOT EXISTS public.access_audit_log (
  audit_id BIGSERIAL PRIMARY KEY,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_data JSONB,
  after_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_access_audit_entity
  ON public.access_audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_audit_actor
  ON public.access_audit_log (actor_id, created_at DESC);

COMMIT;
