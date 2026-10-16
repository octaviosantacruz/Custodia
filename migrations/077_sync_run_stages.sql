-- Per-stage outcome of a synchronization run. Operational metadata only:
-- no payloads, identifiers of upstream objects or exception text.
BEGIN;
CREATE TABLE public.sync_run_stages (
  run_id        UUID NOT NULL REFERENCES public.cyberark_ingestion_runs(run_id) ON DELETE CASCADE,
  position      SMALLINT NOT NULL CHECK (position >= 0),
  stage         TEXT NOT NULL CHECK (stage ~ '^[a-z][a-z0-9_]{0,63}$'),
  required      BOOLEAN NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('completed', 'failed', 'skipped')),
  item_count    INTEGER CHECK (item_count IS NULL OR item_count >= 0),
  duration_ms   INTEGER NOT NULL CHECK (duration_ms >= 0),
  error_kind    TEXT CHECK (error_kind IS NULL OR length(error_kind) <= 120),
  detail        TEXT CHECK (detail IS NULL OR length(detail) <= 200),
  PRIMARY KEY (run_id, position),
  CHECK ((status = 'failed') = (error_kind IS NOT NULL))
);
COMMIT;
