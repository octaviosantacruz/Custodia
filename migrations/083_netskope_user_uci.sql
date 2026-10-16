-- NSK-UBA-002: last User Confidence Index (UCI) reading per Netskope user.
-- Only the latest score, the rating Netskope assigned and, when available, the
-- score about 7 days earlier are kept: never the series, anomalies or any
-- behavioral detail. The table is replaced as a whole by a complete read, so a
-- user that is no longer Poor/Moderate drops out instead of keeping a stale score.
BEGIN;

CREATE TABLE IF NOT EXISTS public.netskope_user_uci (
    email_key TEXT PRIMARY KEY CHECK (email_key = lower(email_key) AND email_key <> ''),
    rating TEXT NOT NULL CHECK (rating IN ('Poor', 'Moderate')),
    score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 1000),
    previous_score INTEGER CHECK (previous_score BETWEEN 0 AND 1000),
    scored_at TIMESTAMPTZ NOT NULL,
    source_run_id UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_netskope_user_uci_rating_score
    ON public.netskope_user_uci (rating, score);

-- Strict permission: neither netskope:read nor access:manage grants it.
INSERT INTO public.access_permissions
  (permission_code, domain_code, resource_code, action_code, description, lifecycle_status)
VALUES
  ('netskope:uba_read', 'dlp', 'uba_uci', 'read', 'Consultar el índice de confianza (UCI) de usuarios Netskope', 'active')
ON CONFLICT (permission_code) DO NOTHING;

COMMIT;
