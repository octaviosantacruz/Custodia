"""Read-only SQL for the Identity + Netskope CONN-001 pilot."""

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool
from app.cross.services.person_email_matching import (
    PERSON_EMAIL_SHAPE_SQL,
    person_email_domain_exclusion_sql,
    person_email_sql,
)
from app.netskope.sse.repositories.netskope_shared import RECENT_DEVICE_CONDITION, observed_user_match_ctes

IDENTITY_SOURCE_SYSTEM = "identity_administration"
IDENTITY_SOURCE_FILE = "identity-administration-scim"
NETSKOPE_SOURCE_SYSTEM = "netskope"
NETSKOPE_SOURCE_FILE = "netskope-api"
PERSON_FRESHNESS_HOURS = 24


_SOURCE_RUNS_SQL = """
        SELECT DISTINCT ON (source_system)
               source_system, source_file, run_id::text AS run_id, status,
               started_at, completed_at
        FROM public.cyberark_ingestion_runs
        WHERE (source_system = %s AND source_file = %s)
           OR (source_system = %s AND source_file = %s)
        ORDER BY source_system, started_at DESC, run_id DESC
    """
SOURCE_RUNS_PARAMS = (
        IDENTITY_SOURCE_SYSTEM, IDENTITY_SOURCE_FILE,
        NETSKOPE_SOURCE_SYSTEM, NETSKOPE_SOURCE_FILE,
)


def _coverage_rows_sql(email: str | None) -> tuple[str, list]:
    observed_ctes, params = observed_user_match_ctes()
    query = f"""
        WITH identity_population AS (
            SELECT o.object_id, o.display_name,
                   {person_email_sql("o.attributes->>'email'")} AS email
            FROM public.cyberark_inventory_objects o
            WHERE o.source_system = %s AND o.object_type = 'user'
              AND o.lifecycle_status = 'active'
              AND o.attributes->>'active' = 'true'
              AND coalesce(o.attributes->>'service_user', 'false') <> 'true'
              AND {person_email_sql("o.attributes->>'email'")} ~ {PERSON_EMAIL_SHAPE_SQL}
              AND {person_email_domain_exclusion_sql("o.attributes->>'email'")}
        ),
        identity_email_counts AS (
            SELECT email, count(*)::int AS identity_records
            FROM identity_population GROUP BY email
        ),
        {observed_ctes},
        netskope_population AS (
            SELECT o.object_id,
                   {person_email_sql("o.email")} AS email
            FROM active_users o
            WHERE {person_email_sql("o.email")} ~ {PERSON_EMAIL_SHAPE_SQL}
              AND {person_email_domain_exclusion_sql("o.email")}
        ),
        netskope_email_counts AS (
            SELECT email, count(*)::int AS netskope_users
            FROM netskope_population GROUP BY email
        ),
        uniquely_observed_devices AS (
            SELECT m.object_id, np.email, m.attributes,
                   CASE WHEN jsonb_typeof(m.attributes->'last_event_timestamp') = 'number'
                        THEN ({RECENT_DEVICE_CONDITION}) ELSE false END AS recent
            FROM matched_devices m
            JOIN active_users ns_user ON ns_user.object_id = m.user_object_id
            JOIN netskope_population np ON np.object_id = ns_user.object_id
            JOIN netskope_email_counts nc ON nc.email = np.email AND nc.netskope_users = 1
            JOIN identity_email_counts ic ON ic.email = np.email AND ic.identity_records = 1
        ),
        -- Keep the grouped evidence independent of the outer person join.
        -- Otherwise PostgreSQL can repeat the full aggregation per person.
        device_counts AS MATERIALIZED (
            SELECT email,
                   count(*) FILTER (WHERE recent)::int AS devices_recent,
                   count(*) FILTER (WHERE NOT recent)::int AS devices_not_recent
            FROM uniquely_observed_devices GROUP BY email
        ),
        ambiguous_observed_devices AS (
            SELECT DISTINCT sd.object_id, np.email
            FROM scoped_devices sd
            JOIN user_keys keys ON keys.key = sd.match_key AND keys.candidates > 1
            JOIN active_users candidate
              ON lower(btrim(coalesce(candidate.source_id, ''))) = keys.key
              OR lower(btrim(coalesce(candidate.email, ''))) = keys.key
            JOIN netskope_population np ON np.object_id = candidate.object_id
        ),
        ambiguous_device_counts AS (
            SELECT email, count(*)::int AS devices_ambiguous
            FROM ambiguous_observed_devices GROUP BY email
        )
        SELECT p.object_id, p.email, p.display_name,
               ic.identity_records,
               coalesce(nc.netskope_users, 0)::int AS netskope_users,
               coalesce(dc.devices_recent, 0)::int AS devices_recent,
               coalesce(dc.devices_not_recent, 0)::int AS devices_not_recent,
               coalesce(ac.devices_ambiguous, 0)::int AS devices_ambiguous
        FROM identity_population p
        JOIN identity_email_counts ic ON ic.email = p.email
        LEFT JOIN netskope_email_counts nc ON nc.email = p.email
        LEFT JOIN device_counts dc ON dc.email = p.email
        LEFT JOIN ambiguous_device_counts ac ON ac.email = p.email
        WHERE (%s::text IS NULL OR p.email = %s)
        ORDER BY p.email, p.object_id
    """
    return query, [IDENTITY_SOURCE_SYSTEM, *params, email, email]


async def get_person_client_coverage_snapshot(
    pool: AsyncConnectionPool, *, email: str | None = None,
) -> dict[str, dict | list[dict]]:
    """Read exact source runs and population in one consistent DB snapshot.

    Repeatable-read prevents a sync committing between the run metadata query
    and the normalized inventory query. It cannot prove per-object historical
    attribution to a run; the persisted schema does not provide a shared
    immutable cross-source snapshot.
    """
    query, params = _coverage_rows_sql(email)
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor(row_factory=dict_row) as cursor:
                await cursor.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
                await cursor.execute(_SOURCE_RUNS_SQL, SOURCE_RUNS_PARAMS)
                run_rows = await cursor.fetchall()
                await cursor.execute(query, tuple(params))
                rows = await cursor.fetchall()
    return {"runs": {row["source_system"]: row for row in run_rows}, "rows": rows}
