"""Read-only observed-policy aggregates for the Netskope alert windows.

NSK-POL-001: only policy names that actually fired in count-only alert
snapshots are exposed. This is never the configured policy catalog and an
absent policy is not reported as disabled. The query is source-scoped to
``source_system = 'netskope'`` and returns no user, event or payload field.
"""

from typing import Any

from psycopg_pool import AsyncConnectionPool

from app.db import fetch_all
from app.netskope.sse.repositories.netskope_shared import POLICY_CAPTURE_MARKER, SOURCE_SYSTEM


async def fetch_observed_policy_rows(pool: AsyncConnectionPool) -> list[dict[str, Any]]:
    """Return the latest completed per-window cohort, with or without policies.

    Each window cohort is the most recent completed Netskope run that wrote the
    ``total`` anchor for that window, so a policy missing from that cohort is
    genuinely absent from the latest capture instead of inherited from an older
    run. The window is always returned (one row with a NULL ``policy`` when it
    has none) together with ``policy_captured``: whether that cohort captured
    the policy dimension at all (a ``policy`` row or the ``policy_capture``
    marker). A cohort that predates the dimension has neither, and must not be
    read as "no policy fired" (NSK-POL-002).

    ``first``/``last captured_at`` are snapshot capture times, never event
    timestamps, and the minimum is bounded by the snapshot retention: it is not
    the policy's first real appearance.
    """
    return await fetch_all(pool, """
        WITH completed_runs AS (
            SELECT ingestion_run.run_id, ingestion_run.completed_at
            FROM public.cyberark_ingestion_runs AS ingestion_run
            WHERE ingestion_run.source_system = %s
              AND ingestion_run.status = 'completed'
              AND ingestion_run.completed_at IS NOT NULL
        ), window_cohorts AS (
            SELECT DISTINCT ON (snapshot.window_days)
                   snapshot.window_days,
                   snapshot.source_run_id AS cohort_run_id
            FROM public.netskope_alert_aggregates AS snapshot
            JOIN completed_runs AS ingestion_run
              ON ingestion_run.run_id = snapshot.source_run_id
            WHERE snapshot.dimension = 'total'
            ORDER BY snapshot.window_days, ingestion_run.completed_at DESC,
                     snapshot.source_run_id DESC
        ), policy_captures AS (
            SELECT snapshot.dimension_value AS policy,
                   min(snapshot.captured_at) AS first_captured_at,
                   max(snapshot.captured_at) AS last_captured_at
            FROM public.netskope_alert_aggregates AS snapshot
            JOIN completed_runs AS ingestion_run
              ON ingestion_run.run_id = snapshot.source_run_id
            WHERE snapshot.dimension = 'policy'
            GROUP BY snapshot.dimension_value
        )
        SELECT cohort.window_days,
               anchor.window_start,
               anchor.window_end,
               anchor.captured_at,
               EXISTS (
                   SELECT 1 FROM public.netskope_alert_aggregates AS evidence
                   WHERE evidence.source_run_id = cohort.cohort_run_id
                     AND evidence.window_days = cohort.window_days
                     AND evidence.dimension IN ('policy', %s)
               ) AS policy_captured,
               snapshot.dimension_value AS policy,
               snapshot.alert_count,
               capture.first_captured_at,
               capture.last_captured_at
        FROM window_cohorts AS cohort
        JOIN public.netskope_alert_aggregates AS anchor
          ON anchor.source_run_id = cohort.cohort_run_id
         AND anchor.window_days = cohort.window_days
         AND anchor.dimension = 'total'
        LEFT JOIN public.netskope_alert_aggregates AS snapshot
          ON snapshot.source_run_id = cohort.cohort_run_id
         AND snapshot.window_days = cohort.window_days
         AND snapshot.dimension = 'policy'
        LEFT JOIN policy_captures AS capture
          ON capture.policy = snapshot.dimension_value
        ORDER BY cohort.window_days, snapshot.alert_count DESC NULLS LAST,
                 snapshot.dimension_value
    """, (SOURCE_SYSTEM, POLICY_CAPTURE_MARKER))


def observed_policy_window_days() -> tuple[int, ...]:
    """Window order published by the observed-policy surface."""
    return (7, 30, 90)


__all__ = ["fetch_observed_policy_rows", "observed_policy_window_days"]
