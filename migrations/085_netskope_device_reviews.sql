-- NSK-DEVREV-001: human classification of Netskope devices without recent events.
-- The decision lives here, apart from the synchronized inventory: no sync
-- writes this table, and a device retired by a sync keeps its decision. The
-- history of every change is the audit log (entity_type 'netskope_device_review').
BEGIN;

CREATE TABLE IF NOT EXISTS public.netskope_device_reviews (
    object_id BIGINT PRIMARY KEY
        REFERENCES public.cyberark_inventory_objects(object_id) ON DELETE RESTRICT,
    diagnosis TEXT NOT NULL CHECK (diagnosis IN (
        'undetermined', 'uninstalled_reported', 'replaced', 'decommissioned',
        'in_use_not_reporting', 'historical_record', 'temporary_exception')),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'investigating', 'ticket_open', 'resolved')),
    owner TEXT CHECK (owner IS NULL OR (owner = btrim(owner) AND owner <> '' AND char_length(owner) <= 120)),
    reference TEXT CHECK (reference IS NULL OR (reference = btrim(reference) AND reference <> '' AND char_length(reference) <= 200)),
    note TEXT CHECK (note IS NULL OR (note = btrim(note) AND note <> '' AND char_length(note) <= 1000)),
    exception_expires_at TIMESTAMPTZ,
    next_review_at DATE,
    -- What the server observed when the decision was saved; never client input.
    evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    decided_by TEXT NOT NULL,
    decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((diagnosis = 'temporary_exception') = (exception_expires_at IS NOT NULL)),
    CHECK (diagnosis <> 'undetermined' OR status IN ('pending', 'investigating')),
    CHECK (status <> 'ticket_open' OR reference IS NOT NULL),
    CHECK (diagnosis <> 'decommissioned' OR reference IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_netskope_device_reviews_diagnosis
    ON public.netskope_device_reviews (diagnosis, status);

COMMIT;
