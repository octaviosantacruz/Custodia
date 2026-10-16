-- RISK-ENT-001: reveal only the entity display name on live Risk Management findings.
-- This permission is separate from general CyberArk risk posture access.
BEGIN;

INSERT INTO public.access_permissions
  (permission_code, domain_code, resource_code, action_code, description, lifecycle_status)
VALUES
  ('pam:risk_entities_read', 'pam', 'risk_entities', 'read', 'Consultar el nombre de la entidad de los hallazgos de Risk Management', 'active')
ON CONFLICT (permission_code) DO NOTHING;

INSERT INTO public.access_role_permissions (role_code, permission_code) VALUES
  ('admin', 'pam:risk_entities_read'),
  ('cyberark_admin', 'pam:risk_entities_read')
ON CONFLICT (role_code, permission_code) DO NOTHING;

COMMIT;
