-- NSK-REF-001: how many live user rows Netskope's API returned more than once (same id, same content) in the
-- run that read the reported total. Netskope's "Total Users" counts rows, DS Hub counts distinct ids, so this
-- is the exact, per-run explanation of the difference. Reference only; null when the run predates the column.
BEGIN;

ALTER TABLE public.netskope_reported_counts
    ADD COLUMN IF NOT EXISTS repeated_user_rows INTEGER CHECK (repeated_user_rows >= 0);

COMMIT;
