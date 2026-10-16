-- NSK-DLP-001: minimal DLP alerts with count-first, per-user drill-down.
--
-- Allowlist persisted per alert: opaque incident ID, UTC timestamp, status,
-- severity, policy, action and the opaque Netskope user ID (used only to
-- resolve the already-persisted Netskope user inventory by exact equality).
-- Never stores file/content, file name, hash, URL, IP, event email/name,
-- dlp_match_info or any forensic payload. Retention is 30 days, enforced by
-- the capture service after every successful capture.
--
-- The capture state row keeps the iterator cursor and honest freshness so the
-- UI never presents a missing capture as zero alerts.
BEGIN;

CREATE TABLE public.netskope_dlp_alerts (
    incident_id TEXT PRIMARY KEY,
    event_timestamp TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT '',
    severity TEXT NOT NULL DEFAULT '',
    policy TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL DEFAULT '',
    user_id TEXT NOT NULL DEFAULT '',
    source_run_id UUID,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX netskope_dlp_alerts_time_idx
    ON public.netskope_dlp_alerts (event_timestamp DESC, incident_id);
CREATE INDEX netskope_dlp_alerts_user_idx
    ON public.netskope_dlp_alerts (user_id, event_timestamp DESC);
CREATE INDEX netskope_dlp_alerts_severity_idx
    ON public.netskope_dlp_alerts (severity, event_timestamp DESC);

CREATE TABLE public.netskope_dlp_capture_state (
    cache_key TEXT PRIMARY KEY CHECK (cache_key = 'default'),
    iterator_index TEXT,
    coverage_start TIMESTAMPTZ,
    coverage_end TIMESTAMPTZ,
    partial BOOLEAN NOT NULL DEFAULT true,
    scanned_events INTEGER NOT NULL DEFAULT 0 CHECK (scanned_events >= 0),
    captured_alerts INTEGER NOT NULL DEFAULT 0 CHECK (captured_alerts >= 0),
    captured_at TIMESTAMPTZ,
    last_run_id UUID
);

-- Purely additive narrow permission: NSK-DLP-001 is deliberately NOT granted
-- by widening netskope:read, access:manage or any existing role. An operator
-- with access:manage keeps the compatible 410 on the revived routes until
-- this permission is explicitly assigned.
INSERT INTO public.access_permissions
  (permission_code, domain_code, resource_code, action_code, description, lifecycle_status)
VALUES
  ('netskope:dlp_read', 'dlp', 'dlp_alerts', 'read', 'Consultar alertas DLP mínimas por usuario, sin artefacto sensible', 'active')
ON CONFLICT (permission_code) DO NOTHING;

COMMIT;
