-- Migration 035: explicit, assignable permissions for existing operational actions.
--
-- Existing broad permissions remain assigned for compatibility; routes below
-- progressively enforce these narrow capabilities.
BEGIN;

INSERT INTO public.access_permissions
  (permission_code, domain_code, resource_code, action_code, description, lifecycle_status)
VALUES
  ('safes:classify', 'pam', 'safes', 'classify', 'Clasificar Safes y cuentas del inventario', 'active'),
  ('safes:bulk_classify', 'pam', 'safes', 'bulk_classify', 'Clasificar varios Safes en una sola operación', 'active'),
  ('connections:import', 'pam', 'connections', 'import', 'Importar inventario operativo de conexiones', 'active'),
  ('ingestion:preview', 'pam', 'ingestion', 'preview', 'Previsualizar cambios de sincronización', 'active'),
  ('ingestion:run', 'pam', 'ingestion', 'run', 'Ejecutar sincronizaciones de inventario', 'active'),
  ('findings:manage', 'pam', 'findings', 'manage', 'Actualizar estado y excepciones de hallazgos', 'active'),
  ('catalogs:manage', 'pam', 'catalogs', 'manage', 'Administrar unidades y responsables', 'active')
ON CONFLICT (permission_code) DO NOTHING;

INSERT INTO public.access_role_permissions (role_code, permission_code) VALUES
  ('operator', 'safes:classify'),
  ('operator', 'safes:bulk_classify'),
  ('operator', 'connections:import'),
  ('operator', 'ingestion:preview'),
  ('operator', 'ingestion:run'),
  ('operator', 'findings:manage'),
  ('operator', 'catalogs:manage'),
  ('admin', 'safes:classify'),
  ('admin', 'safes:bulk_classify'),
  ('admin', 'connections:import'),
  ('admin', 'ingestion:preview'),
  ('admin', 'ingestion:run'),
  ('admin', 'findings:manage'),
  ('admin', 'catalogs:manage'),
  ('cyberark_operator', 'safes:classify'),
  ('cyberark_operator', 'safes:bulk_classify'),
  ('cyberark_operator', 'connections:import'),
  ('cyberark_operator', 'ingestion:preview'),
  ('cyberark_operator', 'ingestion:run'),
  ('cyberark_operator', 'findings:manage'),
  ('cyberark_operator', 'catalogs:manage'),
  ('cyberark_admin', 'safes:classify'),
  ('cyberark_admin', 'safes:bulk_classify'),
  ('cyberark_admin', 'connections:import'),
  ('cyberark_admin', 'ingestion:preview'),
  ('cyberark_admin', 'ingestion:run'),
  ('cyberark_admin', 'findings:manage'),
  ('cyberark_admin', 'catalogs:manage')
ON CONFLICT (role_code, permission_code) DO NOTHING;

COMMIT;
