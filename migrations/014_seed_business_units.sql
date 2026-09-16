-- Migration 014: initial business-unit catalog for the inventory workflow.

BEGIN;

INSERT INTO public.cyberark_business_units (unit_code, unit_name)
VALUES
  ('UENO', 'UENO'),
  ('ITTI', 'ITTI'),
  ('UPAY', 'UPAY'),
  ('UCDB', 'UCDB'),
  ('USEGUROS', 'USEGUROS')
ON CONFLICT (unit_code) DO NOTHING;

COMMIT;
