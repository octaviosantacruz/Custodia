-- NSK-EXP-OFFICE-001: digital experience measured while people were in the office.
-- 1) Each presence day of 108 gains the first and last client event of that device,
--    day and status, so the daily measurement knows each person's office and remote
--    spans without reading the snapshots. Rows the old sync left out since 108 are
--    added here from the snapshots, and existing rows get their spans.
-- 2) netskope_office_experience_days keeps one row per person and UTC day: minutes and
--    ADEM score in the office span and in the remote span. Only minutes and scores:
--    no IP, POP, location or device identifier.
-- 3) netskope_office_experience_measured marks a day as completely measured, so a
--    failed run is retried and a day with nobody in the office is a measured zero.
BEGIN;

ALTER TABLE public.netskope_device_presence_days
    ADD COLUMN IF NOT EXISTS first_event_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_event_at TIMESTAMPTZ;

-- The nested CASE keeps the numeric cast on JSON numbers only (WHERE has no evaluation order);
-- an event later than its capture plus one hour is not trusted, as in 108 and the sync.
INSERT INTO public.netskope_device_presence_days (device_id, event_day, onprem_status, first_event_at, last_event_at)
SELECT device_id, (to_timestamp(event_epoch) AT TIME ZONE 'UTC')::date, onprem_status,
       to_timestamp(min(event_epoch)), to_timestamp(max(event_epoch))
FROM (
    SELECT device_id, attributes->>'onprem_status' AS onprem_status,
           CASE WHEN jsonb_typeof(attributes->'last_event_timestamp') = 'number' THEN
               CASE WHEN (attributes->>'last_event_timestamp')::numeric > 0
                         AND (attributes->>'last_event_timestamp')::numeric <= extract(epoch FROM captured_at) + 3600
                    THEN (attributes->>'last_event_timestamp')::numeric END
           END AS event_epoch
    FROM public.netskope_device_snapshots
    WHERE attributes->>'onprem_status' IN ('on-prem', 'off-prem')
) AS classified
WHERE event_epoch IS NOT NULL
GROUP BY 1, 2, 3
ON CONFLICT (device_id, event_day, onprem_status) DO UPDATE
    SET first_event_at = LEAST(netskope_device_presence_days.first_event_at, EXCLUDED.first_event_at),
        last_event_at = GREATEST(netskope_device_presence_days.last_event_at, EXCLUDED.last_event_at);

CREATE TABLE IF NOT EXISTS public.netskope_office_experience_days (
    event_day DATE NOT NULL,
    email_key TEXT NOT NULL CHECK (email_key = lower(email_key) AND email_key <> ''),
    office_minutes INTEGER NOT NULL DEFAULT 0 CHECK (office_minutes >= 0),
    office_score NUMERIC(5, 2) CHECK (office_score BETWEEN 0 AND 100),
    remote_minutes INTEGER NOT NULL DEFAULT 0 CHECK (remote_minutes >= 0),
    remote_score NUMERIC(5, 2) CHECK (remote_score BETWEEN 0 AND 100),
    source_run_id UUID,
    measured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (event_day, email_key)
);

CREATE TABLE IF NOT EXISTS public.netskope_office_experience_measured (
    event_day DATE PRIMARY KEY,
    people INTEGER NOT NULL CHECK (people >= 0),
    failed_calls INTEGER NOT NULL DEFAULT 0 CHECK (failed_calls >= 0),
    source_run_id UUID,
    measured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
