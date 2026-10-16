-- NSK-POL-002: a window whose `policy` dimension was captured with zero
-- policies is indistinguishable, in the data, from a capture that predates the
-- dimension (migration 075): both have no `policy` rows. A count-only marker
-- row (`policy_capture`, value 'captured', count 0; migration 060 requires a
-- non-empty value for every dimension but `total`) records that the dimension was
-- requested and answered, so "no policy fired" and "no capture" stay distinct.
-- No event, user or payload data is stored.
BEGIN;

ALTER TABLE public.netskope_alert_aggregates
  DROP CONSTRAINT netskope_alert_aggregates_dimension_check;

ALTER TABLE public.netskope_alert_aggregates
  ADD CONSTRAINT netskope_alert_aggregates_dimension_check
    CHECK (dimension IN ('total', 'alert_type', 'severity', 'action', 'policy', 'policy_capture'));

COMMIT;
