-- Persistent-cursor tracking for the Netskope DLP cache. The iterator was
-- found to advance roughly one hour of backlog per page and to return empty
-- pages mid-stream (not only when truly caught up), so a bounded from-scratch
-- walk every few minutes could never reach recent events. The cache is now
-- filled by a continuous poller that resumes from the last confirmed point.
BEGIN;

ALTER TABLE public.netskope_dlp_cache_state
    ADD COLUMN iterator_index TEXT,
    ADD COLUMN coverage_start TIMESTAMPTZ,
    ADD COLUMN coverage_end TIMESTAMPTZ,
    ADD COLUMN consecutive_empty_polls INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN consecutive_errors INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN last_successful_page_at TIMESTAMPTZ;

COMMIT;
