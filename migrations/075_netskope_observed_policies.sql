-- NSK-POL-001: observed real-time policies. Extends the count-only alert
-- aggregate allowlist with the `policy` dimension. No event rows, users, IPs,
-- URLs or forensic payloads are stored; only grouped counts per window.
BEGIN;

-- Migration 060 declared the dimension CHECK inline, so its constraint name is
-- PostgreSQL-generated. Locate it by its definition (the only CHECK mentioning
-- 'alert_type') instead of depending on the generated name.
DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    SELECT con.conname
      INTO constraint_name
      FROM pg_constraint AS con
      JOIN pg_class AS rel ON rel.oid = con.conrelid
      JOIN pg_namespace AS ns ON ns.oid = rel.relnamespace
     WHERE ns.nspname = 'public'
       AND rel.relname = 'netskope_alert_aggregates'
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) LIKE '%alert_type%';
    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.netskope_alert_aggregates DROP CONSTRAINT %I', constraint_name);
    END IF;
END $$;

ALTER TABLE public.netskope_alert_aggregates
  ADD CONSTRAINT netskope_alert_aggregates_dimension_check
    CHECK (dimension IN ('total', 'alert_type', 'severity', 'action', 'policy'));

COMMIT;
