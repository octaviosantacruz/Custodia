-- SAFE-RETENTION-001: CyberArk refuses to delete a Safe while its retention
-- period is running ("Safe ... can not be deleted due to safe retention").
-- Operations needs a manual workflow state for "baja solicitada, retenida por
-- CyberArk". It is a human decision like the other workflow states and is
-- never written by ingestion. The CHECK constraint is replaced by looking up
-- its generated name, because migration 005 did not name it.
BEGIN;

DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    FOR constraint_name IN
        SELECT c.conname
        FROM pg_constraint c
        WHERE c.conrelid = 'public.cyberark_safe_metadata'::regclass
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) LIKE '%workflow_status%'
    LOOP
        EXECUTE format('ALTER TABLE public.cyberark_safe_metadata DROP CONSTRAINT %I', constraint_name);
    END LOOP;
END $$;

ALTER TABLE public.cyberark_safe_metadata
    ADD CONSTRAINT cyberark_safe_metadata_workflow_status_check
    CHECK (workflow_status IN ('pending', 'in_progress', 'blocked', 'resolved', 'retired', 'retention_hold'));

COMMIT;
