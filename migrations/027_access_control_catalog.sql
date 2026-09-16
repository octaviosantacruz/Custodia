-- Migration 027: internal access-control catalog for platform and product roles.
-- Product roles for Netskope and BigID are intentionally marked planned. They
-- describe future entitlements only; no provider integration is implied here.
BEGIN;

ALTER TABLE public.access_roles
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS domain_code TEXT NOT NULL DEFAULT 'platform',
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS system_managed BOOLEAN NOT NULL DEFAULT true;

UPDATE public.access_roles
SET display_name = CASE role_code
    WHEN 'reader' THEN 'Lector de plataforma'
    WHEN 'operator' THEN 'Operador de plataforma'
    WHEN 'admin' THEN 'Administrador de plataforma'
    ELSE initcap(replace(role_code, '_', ' '))
  END
WHERE display_name IS NULL;

ALTER TABLE public.access_roles ALTER COLUMN display_name SET NOT NULL;

CREATE TABLE IF NOT EXISTS public.access_permissions (
  permission_code TEXT PRIMARY KEY,
  domain_code TEXT NOT NULL,
  resource_code TEXT NOT NULL,
  action_code TEXT NOT NULL,
  description TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL DEFAULT 'active',
  system_managed BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.access_permissions
  (permission_code, domain_code, resource_code, action_code, description, lifecycle_status)
VALUES
  ('inventory:read', 'pam', 'inventory', 'read', 'Consultar inventario PAM', 'active'),
  ('inventory:write', 'pam', 'inventory', 'write', 'Editar clasificación y metadatos del inventario', 'active'),
  ('inventory:export', 'pam', 'inventory', 'export', 'Exportar inventario y cuentas', 'active'),
  ('catalogs:read', 'pam', 'catalogs', 'read', 'Consultar catálogos operativos', 'active'),
  ('catalogs:write', 'pam', 'catalogs', 'write', 'Administrar unidades y responsables', 'active'),
  ('access:manage', 'platform', 'access', 'manage', 'Administrar usuarios, roles y permisos de DS Hub', 'active'),
  ('domain:pam', 'pam', 'domain', 'access', 'Ingresar al dominio CyberArk PAM', 'active'),
  ('domain:admin', 'platform', 'domain', 'access', 'Ingresar a la administración de DS Hub', 'active'),
  ('domain:dlp', 'dlp', 'domain', 'access', 'Ingresar al dominio Netskope DLP', 'planned'),
  ('domain:dspm', 'dspm', 'domain', 'access', 'Ingresar al dominio BigID DSPM', 'planned'),
  ('netskope:read', 'dlp', 'workspace', 'read', 'Consultar capacidades de Netskope DLP', 'planned'),
  ('netskope:admin', 'dlp', 'workspace', 'admin', 'Administrar capacidades de Netskope DLP', 'planned'),
  ('bigid:read', 'dspm', 'workspace', 'read', 'Consultar capacidades de BigID DSPM', 'planned'),
  ('bigid:admin', 'dspm', 'workspace', 'admin', 'Administrar capacidades de BigID DSPM', 'planned')
ON CONFLICT (permission_code) DO NOTHING;

INSERT INTO public.access_roles
  (role_code, description, display_name, domain_code, lifecycle_status, system_managed)
VALUES
  ('cyberark_reader', 'Lectura del dominio CyberArk PAM', 'CyberArk · Lector', 'pam', 'active', true),
  ('cyberark_operator', 'Operación del dominio CyberArk PAM', 'CyberArk · Operador', 'pam', 'active', true),
  ('cyberark_admin', 'Administración operativa del dominio CyberArk PAM', 'CyberArk · Administrador', 'pam', 'active', true),
  ('netskope_reader', 'Preparado para lectura de Netskope DLP', 'Netskope · Lector', 'dlp', 'planned', true),
  ('netskope_admin', 'Preparado para administración de Netskope DLP', 'Netskope · Administrador', 'dlp', 'planned', true),
  ('bigid_reader', 'Preparado para lectura de BigID DSPM', 'BigID · Lector', 'dspm', 'planned', true),
  ('bigid_admin', 'Preparado para administración de BigID DSPM', 'BigID · Administrador', 'dspm', 'planned', true)
ON CONFLICT (role_code) DO NOTHING;

INSERT INTO public.access_role_permissions (role_code, permission_code) VALUES
  ('cyberark_reader', 'inventory:read'),
  ('cyberark_reader', 'domain:pam'),
  ('cyberark_operator', 'inventory:read'),
  ('cyberark_operator', 'inventory:write'),
  ('cyberark_operator', 'catalogs:read'),
  ('cyberark_operator', 'domain:pam'),
  ('cyberark_admin', 'inventory:read'),
  ('cyberark_admin', 'inventory:write'),
  ('cyberark_admin', 'inventory:export'),
  ('cyberark_admin', 'catalogs:read'),
  ('cyberark_admin', 'catalogs:write'),
  ('cyberark_admin', 'domain:pam'),
  ('netskope_reader', 'domain:dlp'),
  ('netskope_reader', 'netskope:read'),
  ('netskope_admin', 'domain:dlp'),
  ('netskope_admin', 'netskope:read'),
  ('netskope_admin', 'netskope:admin'),
  ('bigid_reader', 'domain:dspm'),
  ('bigid_reader', 'bigid:read'),
  ('bigid_admin', 'domain:dspm'),
  ('bigid_admin', 'bigid:read'),
  ('bigid_admin', 'bigid:admin')
ON CONFLICT (role_code, permission_code) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_access_roles_domain_status
  ON public.access_roles (domain_code, lifecycle_status, display_name);

COMMIT;
