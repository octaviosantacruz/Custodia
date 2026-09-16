-- Migration 020: use one canonical label for CyberArk-managed accounts.
-- Legacy imports/designs used INTERNO CYBERARK, CyberArk Managed, or
-- CYBERARK_MANAGED for the same category. NO NOMINAL remains separate.

BEGIN;

WITH normalized AS (
  SELECT
    grouped.safe_number,
    jsonb_object_agg(normalized_key, to_jsonb(total_count)) AS account_types
  FROM (
    SELECT
      m.safe_number,
      CASE
        WHEN upper(trim(type.key)) IN (
          'INTERNO CYBERARK', 'CYBERARK MANAGED', 'CYBERARK_MANAGED'
        ) THEN 'CYBERARK MANAGED'
        ELSE upper(trim(type.key))
      END AS normalized_key,
      sum(type.value::integer) AS total_count
    FROM public.cyberark_safe_metadata m
    CROSS JOIN LATERAL jsonb_each_text(coalesce(m.inventory_account_types, '{}'::jsonb)) AS type(key, value)
    GROUP BY m.safe_number,
      CASE
        WHEN upper(trim(type.key)) IN (
          'INTERNO CYBERARK', 'CYBERARK MANAGED', 'CYBERARK_MANAGED'
        ) THEN 'CYBERARK MANAGED'
        ELSE upper(trim(type.key))
      END
  ) AS grouped
  GROUP BY safe_number
)
UPDATE public.cyberark_safe_metadata AS target
SET inventory_account_types = normalized.account_types
FROM normalized
WHERE target.safe_number = normalized.safe_number
  AND target.inventory_account_types IS DISTINCT FROM normalized.account_types;

COMMIT;
