-- VIEW-002: Netskope widgets gain size and order (widget instances).
-- Additive: rows saved before this migration keep loading from the legacy
-- data_widgets/chart_widgets arrays, and the new column stays nullable so an
-- older backend can still read and write the table.
BEGIN;

ALTER TABLE public.user_netskope_dashboard_preferences
  ADD COLUMN widgets JSONB;

ALTER TABLE public.user_netskope_dashboard_preferences
  ADD CONSTRAINT user_netskope_widgets_array
  CHECK (widgets IS NULL OR jsonb_typeof(widgets) = 'array');

ALTER TABLE public.user_netskope_dashboard_preferences
  ADD CONSTRAINT user_netskope_widgets_limit
  CHECK (widgets IS NULL OR jsonb_array_length(widgets) <= 12);

COMMIT;
