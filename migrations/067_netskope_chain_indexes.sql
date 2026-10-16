-- CHAIN-005: expression indexes for the Netskope chain lookups.
--
-- The user <-> device observed match compares lower(btrim(...)) over the
-- device username and over the user's source_id/email. Without indexes the
-- worst-case expansion (42 devices for one user) scanned the whole user
-- catalog per device: 3.4-6.4 s measured read-only on 2026-09-25, far above
-- the 300 ms acceptance threshold. Search (ILIKE '%..%') stays on a
-- sequential scan and already runs in 10-128 ms.
--
-- Additive and idempotent: only indexes, no data changes.
BEGIN;

CREATE INDEX IF NOT EXISTS cyberark_inventory_objects_source_id_lower_idx
  ON public.cyberark_inventory_objects (lower(btrim(source_id)));

CREATE INDEX IF NOT EXISTS cyberark_inventory_objects_email_lower_idx
  ON public.cyberark_inventory_objects (lower(btrim(attributes->>'email')));

CREATE INDEX IF NOT EXISTS cyberark_inventory_objects_username_lower_idx
  ON public.cyberark_inventory_objects (lower(btrim(attributes->>'username')));

COMMIT;
