-- Migration 033: allow up to twelve widgets in the personal dashboard.
-- Existing preferences remain valid; this only expands the JSON array limit.
BEGIN;

ALTER TABLE public.user_dashboard_preferences
  DROP CONSTRAINT user_dashboard_widget_limit,
  ADD CONSTRAINT user_dashboard_widget_limit CHECK (jsonb_array_length(widgets) <= 12);

COMMIT;
