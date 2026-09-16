-- Migration 029: personal PAM dashboard metric selection.
-- actor_id is intentionally not a foreign key because OIDC identities may
-- have role assignments without a local access_users row.
BEGIN;

CREATE TABLE public.user_dashboard_preferences (
  actor_id TEXT PRIMARY KEY,
  widgets JSONB NOT NULL DEFAULT '[]'::JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_dashboard_widgets_array CHECK (jsonb_typeof(widgets) = 'array'),
  CONSTRAINT user_dashboard_widget_limit CHECK (jsonb_array_length(widgets) <= 6)
);

COMMIT;
