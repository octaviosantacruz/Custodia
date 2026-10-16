-- Proyección operativa de la regla que produjo un incidente DLP.
-- Nunca persiste dlp_match_info ni sus identificadores forenses.
BEGIN;

ALTER TABLE public.netskope_dlp_event_cache
    ADD COLUMN dlp_policy TEXT NOT NULL DEFAULT '',
    ADD COLUMN dlp_profile_name TEXT NOT NULL DEFAULT '',
    ADD COLUMN dlp_rule_name TEXT NOT NULL DEFAULT '';

CREATE INDEX netskope_dlp_event_cache_rule_idx
    ON public.netskope_dlp_event_cache (dlp_rule_name, event_timestamp DESC);

COMMIT;
