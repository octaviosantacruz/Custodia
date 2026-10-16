-- Aggregate only: no account identifiers, overview payloads or credentials.
BEGIN;

CREATE TABLE public.cyberark_compliance_snapshot (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  total_accounts INTEGER NOT NULL CHECK (total_accounts > 0),
  compliant_accounts INTEGER NOT NULL CHECK (compliant_accounts >= 0 AND compliant_accounts <= total_accounts),
  measured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
