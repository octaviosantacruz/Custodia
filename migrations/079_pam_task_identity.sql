-- SYNC-TASK-002: PAM's two jobs get their own task identity. Safes and the
-- isolated PSM catalog refresh shared task_key = 'cyberark' (migration 078),
-- so they shared cadence, backoff and history. source_system stays 'cyberark'.
BEGIN;

UPDATE public.cyberark_ingestion_runs
SET task_key = CASE
  WHEN source_file = 'cyberark-psm-api' OR run_options->>'psm_only' = 'true' THEN 'pam_psm'
  ELSE 'pam_safes'
END
WHERE source_system = 'cyberark' AND task_key = 'cyberark';

-- Producers that do not name a task (the Safe pipeline's own insert, scripts)
-- still resolve to a precise PAM task instead of the old shared one.
CREATE OR REPLACE FUNCTION public.default_ingestion_run_task_key() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.task_key IS NULL THEN
    NEW.task_key := CASE
      WHEN NEW.source_system = 'cyberark'
        THEN CASE
          WHEN NEW.source_file = 'cyberark-psm-api' OR NEW.run_options->>'psm_only' = 'true' THEN 'pam_psm'
          ELSE 'pam_safes'
        END
      ELSE NEW.source_system
    END;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
