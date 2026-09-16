-- Migration 044: split access:manage into narrower, purpose-built read
-- permissions for PAM/SIA/Identity technical catalogs.
--
-- Today the ONLY way to see PAM technical catalogs (platforms, PSM
-- connectors, components, AIM applications, Access space assets), SIA
-- connectors/resources/database accounts, or Identity Administration
-- federations is to hold access:manage -- the same permission that grants
-- full user/role administration. A PAM operator role (cyberark_operator)
-- has zero visibility into PAM's own technical catalogs today, even though
-- that data is squarely PAM's.
--
-- This migration is purely additive: access:manage keeps working exactly
-- as before (every route below now accepts EITHER access:manage OR the new
-- narrow permission, via require_any_permission -- see auth.py and
-- api/routes/cmdb.py). No existing role loses anything; cyberark_operator/
-- cyberark_admin (which previously had no access to these routes at all)
-- gain read visibility into PAM's own catalogs, and two new opt-in roles
-- (sia_reader, identity_reader) exist for granting SIA/Identity catalog
-- visibility without granting access:manage.
--
-- sia-policies/sia-destinations and identity-users/identity-roles are
-- deliberately left untouched (they already only require the baseline
-- inventory:read, an existing inconsistency noted separately in the
-- workspace audit but out of scope for this migration).
BEGIN;

INSERT INTO public.access_domains
  (domain_code, display_name, lifecycle_status, sort_order)
VALUES
  ('sia', 'Secure Infrastructure Access', 'active', 50),
  ('identity', 'Identity Administration', 'active', 60)
ON CONFLICT (domain_code) DO NOTHING;

INSERT INTO public.access_permissions
  (permission_code, domain_code, resource_code, action_code, description, lifecycle_status)
VALUES
  ('pam:catalogs_read', 'pam', 'catalogs', 'read', 'Consultar catálogos técnicos de PAM: plataformas, conectores PSM, componentes, aplicaciones AIM y assets de Access', 'active'),
  ('domain:sia', 'sia', 'domain', 'access', 'Ingresar al dominio SIA', 'active'),
  ('sia:catalogs_read', 'sia', 'catalogs', 'read', 'Consultar catálogos técnicos de SIA: conectores, recursos y cuentas fuertes de base de datos', 'active'),
  ('domain:identity', 'identity', 'domain', 'access', 'Ingresar al dominio Identity Administration', 'active'),
  ('identity:catalogs_read', 'identity', 'catalogs', 'read', 'Consultar el catálogo de federaciones de Identity Administration', 'active')
ON CONFLICT (permission_code) DO NOTHING;

INSERT INTO public.access_roles
  (role_code, description, display_name, domain_code, lifecycle_status, system_managed)
VALUES
  ('sia_reader', 'Lectura de catálogos técnicos SIA', 'SIA · Lector', 'sia', 'active', true),
  ('identity_reader', 'Lectura del catálogo de federaciones de Identity Administration', 'Identity · Lector', 'identity', 'active', true)
ON CONFLICT (role_code) DO NOTHING;

INSERT INTO public.access_domain_levels
  (domain_code, level_code, display_name, base_role_code, sort_order)
VALUES
  ('sia', 'reader', 'Lector', 'sia_reader', 10),
  ('identity', 'reader', 'Lector', 'identity_reader', 10)
ON CONFLICT (domain_code, level_code) DO NOTHING;

INSERT INTO public.access_role_permissions (role_code, permission_code) VALUES
  ('cyberark_operator', 'pam:catalogs_read'),
  ('cyberark_admin', 'pam:catalogs_read'),
  ('sia_reader', 'domain:sia'),
  ('sia_reader', 'sia:catalogs_read'),
  ('identity_reader', 'domain:identity'),
  ('identity_reader', 'identity:catalogs_read')
ON CONFLICT (role_code, permission_code) DO NOTHING;

COMMIT;
