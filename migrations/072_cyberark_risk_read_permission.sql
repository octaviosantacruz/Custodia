-- RISK-001: read-only access to live CyberArk Risk Management data.
-- This permission does not grant access:manage and no CyberArk risk payload is persisted.
BEGIN;

INSERT INTO public.access_permissions
  (permission_code, domain_code, resource_code, action_code, description, lifecycle_status)
VALUES
  ('pam:risk_read', 'pam', 'risk_posture', 'read', 'Consultar postura de riesgo calculada por CyberArk en modo sólo lectura', 'active')
ON CONFLICT (permission_code) DO NOTHING;

INSERT INTO public.access_role_permissions (role_code, permission_code) VALUES
  ('reader', 'pam:risk_read'),
  ('operator', 'pam:risk_read'),
  ('admin', 'pam:risk_read'),
  ('cyberark_reader', 'pam:risk_read'),
  ('cyberark_operator', 'pam:risk_read'),
  ('cyberark_admin', 'pam:risk_read')
ON CONFLICT (role_code, permission_code) DO NOTHING;

COMMIT;
