-- Operational read models; no login, grant, API or ingestion changes.
BEGIN;

CREATE SCHEMA IF NOT EXISTS reporting;
REVOKE ALL ON SCHEMA reporting FROM PUBLIC;

-- Separate flows: a successful PSM/import run cannot hide a failed inventory run.
CREATE VIEW reporting.source_sync_status WITH (security_barrier = true) AS
WITH streams AS (
    SELECT DISTINCT source_system, source_file FROM public.cyberark_ingestion_runs
    UNION SELECT 'netskope', 'netskope-api'
), latest AS (
    SELECT DISTINCT ON (source_system, source_file)
        source_system, source_file, run_id, status, started_at, completed_at
    FROM public.cyberark_ingestion_runs
    ORDER BY source_system, source_file, started_at DESC, run_id DESC
)
SELECT s.source_system, s.source_file, r.run_id, r.status,
       r.started_at, r.completed_at, statement_timestamp() AS as_of,
       CASE WHEN s.source_system = 'netskope' AND s.source_file = 'netskope-api'
            THEN 24 END AS freshness_hours,
       CASE WHEN s.source_system = 'netskope' AND s.source_file = 'netskope-api'
            THEN coalesce(r.status = 'completed' AND r.completed_at BETWEEN
                 statement_timestamp() - interval '24 hours' AND statement_timestamp(), false)
            END AS source_fresh
FROM streams s LEFT JOIN latest r
  ON r.source_system = s.source_system AND r.source_file IS NOT DISTINCT FROM s.source_file
OFFSET 0;

-- Timestamp validation and company fallback match netskope_shared.py.
-- Snapshot sync time is not the time of a client event.
CREATE VIEW reporting.netskope_devices WITH (security_barrier = true) AS
WITH devices AS (
    SELECT object_id, source_system, source_id, display_name, lifecycle_status,
           data_quality_status, first_seen_at, last_seen_at, source_run_id, attributes,
           CASE WHEN jsonb_typeof(attributes->'last_event_timestamp') = 'number' THEN CASE WHEN (attributes->>'last_event_timestamp')::numeric > 0 AND (attributes->>'last_event_timestamp')::numeric <= extract(epoch FROM statement_timestamp()) THEN (attributes->>'last_event_timestamp')::numeric END END AS event_epoch
    FROM public.cyberark_inventory_objects
    WHERE source_system = 'netskope' AND object_type = 'device' AND lifecycle_status = 'active'
)
SELECT object_id, source_system, source_id AS device_id, display_name,
       lifecycle_status, data_quality_status, first_seen_at,
       last_seen_at AS inventory_observed_at, source_run_id,
       attributes->>'hostname' AS hostname, attributes->>'username' AS username,
       coalesce(nullif(attributes->>'company', ''), upper(split_part(split_part(lower(coalesce(nullif(btrim(attributes->>'username'), ''), nullif(btrim(attributes->>'user_key'), ''), '')), '@', 2), '.', 1))) AS company,
       attributes->>'os' AS os, attributes->>'os_version' AS os_version,
       attributes->>'client_version' AS client_version,
       attributes->>'classification_status' AS classification_status,
       attributes->>'device_make' AS device_make, attributes->>'device_model' AS device_model,
       attributes->>'last_seen_event' AS last_seen_event,
       to_timestamp(event_epoch::double precision) AS last_event_at,
       (extract(epoch FROM statement_timestamp()) - event_epoch) / 86400 AS event_age_days,
       statement_timestamp() AS as_of
FROM devices
OFFSET 0;

-- All active devices, including those without a decision. Retired decisions stay in the base table.
CREATE VIEW reporting.netskope_device_reviews WITH (security_barrier = true) AS
SELECT d.object_id, d.device_id, d.display_name, d.hostname, d.username, d.company, d.os,
       d.last_event_at, d.event_age_days, d.inventory_observed_at,
       (r.object_id IS NOT NULL) AS review_saved,
       coalesce(r.diagnosis, 'undetermined') AS diagnosis,
       r.status AS stored_status, CASE WHEN r.diagnosis = 'temporary_exception' AND r.exception_expires_at <= now()
    THEN 'pending' ELSE r.status END AS effective_status,
       coalesce(r.diagnosis = 'temporary_exception' AND r.exception_expires_at <= now(), false) AS exception_expired,
       r.owner, r.reference, r.note, r.exception_expires_at, r.next_review_at,
       r.decided_by, r.decided_at, r.updated_at AS review_updated_at, d.as_of
FROM reporting.netskope_devices d
LEFT JOIN public.netskope_device_reviews r ON r.object_id = d.object_id
OFFSET 0;

-- OFFSET prevents automatic updates even if the SELECT is simplified in the future.
REVOKE ALL ON reporting.source_sync_status, reporting.netskope_devices,
    reporting.netskope_device_reviews FROM PUBLIC;

COMMENT ON SCHEMA reporting IS 'Explicit operational read models; PostgreSQL grants do not inherit DS Hub permissions.';
COMMENT ON VIEW reporting.netskope_devices IS 'Active Netskope device projection; no raw payload or heartbeat. Inventory observation is not client activity.';
COMMENT ON VIEW reporting.netskope_device_reviews IS 'Human decisions on active Netskope devices; notes and references require explicit authorized SQL access.';
COMMENT ON VIEW reporting.source_sync_status IS 'Latest run per source and flow, including failures; freshness policy exists here only for netskope-api (24 h).';

COMMIT;
