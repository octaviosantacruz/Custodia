-- Separa la acción DLP de Netskope del estado del incidente.
-- Ambos son datos operativos allowlisteados; no guarda dlp_match_info.
BEGIN;

ALTER TABLE public.netskope_dlp_event_cache
    ADD COLUMN incident_status TEXT NOT NULL DEFAULT '';

CREATE INDEX netskope_dlp_event_cache_status_idx
    ON public.netskope_dlp_event_cache (incident_status, event_timestamp DESC);

COMMIT;
