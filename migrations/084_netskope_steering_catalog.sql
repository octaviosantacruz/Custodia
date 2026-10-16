-- NSK-IPSEC-001 / NSK-GRE-001: steering POP catalog and tunnel summary.
-- POPs are Netskope's own catalog of points of presence that accept IPsec/GRE
-- tunnels (identical for every tenant), so the table keeps only the display
-- fields: never the gateway or probe IP. Tunnels are kept as counts and limits:
-- the tenant has none yet, so no tunnel field is mapped before a real one exists.
-- Both tables are replaced as a whole by a complete read.
BEGIN;

CREATE TABLE IF NOT EXISTS public.netskope_steering_pops (
    kind TEXT NOT NULL CHECK (kind IN ('ipsec', 'gre')),
    pop_id TEXT NOT NULL CHECK (pop_id <> ''),
    name TEXT NOT NULL,
    region TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    bandwidth TEXT NOT NULL DEFAULT '',
    distance_miles INTEGER CHECK (distance_miles IS NULL OR distance_miles >= 0),
    accepting_tunnels BOOLEAN NOT NULL,
    release_day TEXT NOT NULL DEFAULT '',
    source_run_id UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (kind, pop_id)
);

CREATE INDEX IF NOT EXISTS idx_netskope_steering_pops_region
    ON public.netskope_steering_pops (kind, region, name);

CREATE TABLE IF NOT EXISTS public.netskope_steering_tunnels (
    kind TEXT PRIMARY KEY CHECK (kind IN ('ipsec', 'gre')),
    tunnel_count INTEGER NOT NULL CHECK (tunnel_count >= 0),
    max_sites INTEGER CHECK (max_sites IS NULL OR max_sites >= 0),
    tunnel_pops INTEGER CHECK (tunnel_pops IS NULL OR tunnel_pops >= 0),
    source_run_id UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
