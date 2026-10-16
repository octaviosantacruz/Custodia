-- Personal Netskope dashboard selection, isolated from the PAM dashboard.
-- actor_id is intentionally not a foreign key because OIDC identities may
-- not have a local access_users row.
BEGIN;

CREATE TABLE public.user_netskope_dashboard_preferences (
  actor_id TEXT PRIMARY KEY,
  data_widgets JSONB NOT NULL DEFAULT '[]'::JSONB,
  chart_widgets JSONB NOT NULL DEFAULT '[]'::JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_netskope_data_widgets_array CHECK (jsonb_typeof(data_widgets) = 'array'),
  CONSTRAINT user_netskope_chart_widgets_array CHECK (jsonb_typeof(chart_widgets) = 'array'),
  CONSTRAINT user_netskope_data_widget_limit CHECK (jsonb_array_length(data_widgets) <= 6),
  CONSTRAINT user_netskope_chart_widget_limit CHECK (jsonb_array_length(chart_widgets) <= 6)
);

COMMIT;
