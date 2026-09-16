-- Migration 028: composable access roles by domain-level reference.
-- Composite roles never copy permissions. Effective permissions are resolved
-- through the selected base role for each domain.
BEGIN;

CREATE TABLE public.access_domains (
  domain_code TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL CHECK (lifecycle_status IN ('active', 'planned')),
  sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT INTO public.access_domains
  (domain_code, display_name, lifecycle_status, sort_order)
VALUES
  ('platform', 'Plataforma', 'active', 10),
  ('pam', 'CyberArk PAM', 'active', 20),
  ('dlp', 'Netskope DLP', 'planned', 30),
  ('dspm', 'BigID DSPM', 'planned', 40)
ON CONFLICT (domain_code) DO NOTHING;

ALTER TABLE public.access_roles
  ADD COLUMN role_kind TEXT NOT NULL DEFAULT 'direct'
    CHECK (role_kind IN ('direct', 'composite'));

ALTER TABLE public.access_roles
  ALTER COLUMN domain_code DROP NOT NULL;

ALTER TABLE public.access_roles
  ADD CONSTRAINT access_roles_domain_fk
  FOREIGN KEY (domain_code) REFERENCES public.access_domains(domain_code);

ALTER TABLE public.access_roles
  ADD CONSTRAINT access_roles_kind_domain_check
  CHECK (
    (role_kind = 'direct' AND domain_code IS NOT NULL)
    OR (role_kind = 'composite' AND domain_code IS NULL)
  );

ALTER TABLE public.access_roles
  ADD CONSTRAINT access_roles_code_domain_unique
  UNIQUE (role_code, domain_code);

ALTER TABLE public.access_permissions
  ADD CONSTRAINT access_permissions_domain_fk
  FOREIGN KEY (domain_code) REFERENCES public.access_domains(domain_code);

CREATE TABLE public.access_domain_levels (
  domain_code TEXT NOT NULL REFERENCES public.access_domains(domain_code) ON DELETE RESTRICT,
  level_code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  base_role_code TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (domain_code, level_code),
  FOREIGN KEY (base_role_code, domain_code)
    REFERENCES public.access_roles(role_code, domain_code) ON DELETE RESTRICT
);

INSERT INTO public.access_domain_levels
  (domain_code, level_code, display_name, base_role_code, sort_order)
VALUES
  ('platform', 'reader', 'Lector', 'reader', 10),
  ('platform', 'operator', 'Operador', 'operator', 20),
  ('platform', 'admin', 'Administrador', 'admin', 30),
  ('pam', 'reader', 'Lector', 'cyberark_reader', 10),
  ('pam', 'operator', 'Operador', 'cyberark_operator', 20),
  ('pam', 'admin', 'Administrador', 'cyberark_admin', 30),
  ('dlp', 'reader', 'Lector', 'netskope_reader', 10),
  ('dlp', 'admin', 'Administrador', 'netskope_admin', 30),
  ('dspm', 'reader', 'Lector', 'bigid_reader', 10),
  ('dspm', 'admin', 'Administrador', 'bigid_admin', 30)
ON CONFLICT (domain_code, level_code) DO NOTHING;

CREATE TABLE public.access_custom_role_levels (
  custom_role_code TEXT NOT NULL REFERENCES public.access_roles(role_code) ON DELETE CASCADE,
  domain_code TEXT NOT NULL,
  level_code TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (custom_role_code, domain_code),
  FOREIGN KEY (domain_code, level_code)
    REFERENCES public.access_domain_levels(domain_code, level_code) ON DELETE RESTRICT
);

CREATE INDEX idx_access_custom_role_levels_selection
  ON public.access_custom_role_levels (domain_code, level_code);

CREATE VIEW public.access_effective_role_permissions AS
SELECT role_code, permission_code
FROM public.access_role_permissions
UNION
SELECT selection.custom_role_code AS role_code,
       permission.permission_code
FROM public.access_custom_role_levels selection
JOIN public.access_domain_levels level
  ON level.domain_code = selection.domain_code
 AND level.level_code = selection.level_code
JOIN public.access_role_permissions permission
  ON permission.role_code = level.base_role_code;

COMMIT;
