-- Extiende el cache sanitario con el mínimo contexto operativo del contrato
-- events/incident. No guarda dlp_match_info, rutas, URLs, IPs ni payloads.
BEGIN;

ALTER TABLE public.netskope_dlp_event_cache
    ADD COLUMN site TEXT NOT NULL DEFAULT '',
    ADD COLUMN user_id TEXT NOT NULL DEFAULT '';

CREATE INDEX netskope_dlp_event_cache_user_id_idx
    ON public.netskope_dlp_event_cache (user_id, event_timestamp DESC);

COMMIT;
