-- Migration 032: imported connection inventory for PAM/SIA coverage review.
-- The imported source is kept separate from verified CyberArk/SIA observations.
BEGIN;

CREATE TABLE IF NOT EXISTS public.connection_inventory_imports (
  import_id       UUID PRIMARY KEY,
  file_name       TEXT NOT NULL,
  row_count       INT NOT NULL CHECK (row_count >= 0),
  imported_by     TEXT NOT NULL,
  is_current      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_connection_inventory_one_current
  ON public.connection_inventory_imports (is_current)
  WHERE is_current IS TRUE;

CREATE TABLE IF NOT EXISTS public.connection_inventory (
  inventory_id       BIGSERIAL PRIMARY KEY,
  import_id          UUID NOT NULL REFERENCES public.connection_inventory_imports(import_id),
  source_row_number  INT NOT NULL CHECK (source_row_number >= 2),
  instance_name      TEXT NOT NULL,
  environment        TEXT NOT NULL DEFAULT '',
  private_ip         TEXT NOT NULL,
  port               INT CHECK (port IS NULL OR (port >= 1 AND port <= 65535)),
  ca_sia             BOOLEAN,
  ca_dba             BOOLEAN,
  zsp_implemented     BOOLEAN,
  access_available    BOOLEAN,
  description        TEXT NOT NULL DEFAULT '',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (import_id, source_row_number)
);

CREATE INDEX IF NOT EXISTS idx_connection_inventory_import_ip
  ON public.connection_inventory (import_id, lower(private_ip));
CREATE INDEX IF NOT EXISTS idx_connection_inventory_instance
  ON public.connection_inventory (import_id, lower(instance_name));

COMMIT;
