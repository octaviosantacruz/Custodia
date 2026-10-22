-- NSK-EXP-PRESENCE-001: the days each device reported from the office or from outside,
-- as Netskope's On-Premises Detection classified its last client event. One row per
-- device, UTC event day and status, written by every inventory sync next to the device
-- snapshots, so "who went to the office this week" reads a few hundred rows instead of
-- the ~30-minute snapshots. Only the category is kept: no IP, POP, match_ip or location.
BEGIN;

CREATE TABLE IF NOT EXISTS public.netskope_device_presence_days (
    device_id TEXT NOT NULL,
    event_day DATE NOT NULL,
    onprem_status TEXT NOT NULL CHECK (onprem_status IN ('on-prem', 'off-prem')),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (device_id, event_day, onprem_status)
);

CREATE INDEX IF NOT EXISTS netskope_device_presence_days_day_idx
    ON public.netskope_device_presence_days (event_day);

-- Backfill from the stored snapshots (onprem_status exists since 2026-10-10). The day is the
-- one of the device's last event, so a switched-off device repeating an old status does not
-- create later days; an event later than its capture plus one hour is not trusted.
-- The nested CASE keeps the numeric cast on JSON numbers only (WHERE has no evaluation order).
INSERT INTO public.netskope_device_presence_days (device_id, event_day, onprem_status)
SELECT DISTINCT device_id, (to_timestamp(event_epoch) AT TIME ZONE 'UTC')::date, onprem_status
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
ON CONFLICT DO NOTHING;

COMMIT;
