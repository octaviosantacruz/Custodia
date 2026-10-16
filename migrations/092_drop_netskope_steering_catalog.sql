-- Steering view and sync removed (2026-10-10): the POP catalog of 084 is
-- Netskope's own list, identical for every tenant, and the tenant has no
-- IPsec/GRE tunnels, so neither table held inventory of this tenant. The
-- catalog can be read again from the vendor if a tunnel contract returns.
BEGIN;

DROP TABLE IF EXISTS public.netskope_steering_pops;
DROP TABLE IF EXISTS public.netskope_steering_tunnels;

COMMIT;
