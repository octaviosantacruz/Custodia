-- VIEW-006: versioned dashboard templates published to access roles.
-- Publishing only appends a template version; personal preferences are never
-- updated implicitly and remain owned by each actor.
BEGIN;

CREATE TABLE public.role_dashboard_templates (
  role_code TEXT NOT NULL REFERENCES public.access_roles(role_code),
  dashboard_kind TEXT NOT NULL CHECK (dashboard_kind IN ('cyberark', 'netskope')),
  version INTEGER NOT NULL CHECK (version > 0),
  widgets JSONB NOT NULL CHECK (jsonb_typeof(widgets) = 'array' AND jsonb_array_length(widgets) <= 12),
  published_by TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (role_code, dashboard_kind, version)
);

CREATE INDEX role_dashboard_templates_latest_idx
  ON public.role_dashboard_templates (role_code, dashboard_kind, version DESC);

COMMIT;
