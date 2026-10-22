"""NSK-EXP-OFFICE-001 persistence: office/remote spans per person and day, and their measured ADEM scores.

The person is tied to a device only by the device's reported username being exactly their email
(lower/trim), as for presence; no similarity. Only people who were in the office within a week of
the day are measured, so remote spans are scored just for comparison with their own office days.
"""

from datetime import date
from typing import Any
from uuid import UUID

from psycopg_pool import AsyncConnectionPool

from app.db import fetch_all
from app.cross.services.person_email_matching import person_email_sql
from app.netskope.sse.repositories.netskope_shared import SOURCE_SYSTEM, USER_COMPANY, _bucket

RETENTION_DAYS = 180
_PERSON_DEVICES = """
    FROM public.netskope_device_presence_days p
    JOIN public.cyberark_inventory_objects o
      ON o.source_id = p.device_id AND o.source_system = %s AND o.object_type = 'device' AND o.lifecycle_status = 'active'
"""
_EMAIL = "lower(btrim(o.attributes->>'username'))"


async def office_spans_for_day(pool: AsyncConnectionPool, day: date) -> list[dict[str, Any]]:
    """First and last on-prem / off-prem event of each office-goer on that UTC day, across their devices."""
    return await fetch_all(
        pool,
        f"""WITH goers AS (
                SELECT DISTINCT {_EMAIL} AS email {_PERSON_DEVICES}
                WHERE p.onprem_status = 'on-prem' AND p.event_day BETWEEN %s::date - 7 AND %s::date + 7
                  AND {_EMAIL} LIKE '%%@%%'
            )
            SELECT {_EMAIL} AS email, p.onprem_status, min(p.first_event_at) AS first_event_at, max(p.last_event_at) AS last_event_at
            {_PERSON_DEVICES}
            JOIN goers g ON g.email = {_EMAIL}
            WHERE p.event_day = %s AND p.first_event_at IS NOT NULL
            GROUP BY 1, 2
            ORDER BY 1, 2""",
        (SOURCE_SYSTEM, day, day, SOURCE_SYSTEM, day),
    )


async def pending_office_days(pool: AsyncConnectionPool, first: date, last: date) -> list[date]:
    """Days in [first, last] not yet completely measured, oldest first."""
    rows = await fetch_all(
        pool,
        """SELECT day::date AS day FROM generate_series(%s::date, %s::date, interval '1 day') AS day
           WHERE NOT EXISTS (SELECT 1 FROM public.netskope_office_experience_measured m WHERE m.event_day = day::date)
           ORDER BY 1""",
        (first, last),
    )
    return [row["day"] for row in rows]


async def replace_office_experience_day(
    pool: AsyncConnectionPool, run_id: UUID, day: date, rows: list[dict[str, Any]], failed_calls: int,
) -> None:
    """Replace one day's measurement and mark it complete in one transaction; purge expired days."""
    async with pool.connection() as conn:
        async with conn.transaction():
            await conn.execute("DELETE FROM public.netskope_office_experience_days WHERE event_day = %s", (day,))
            async with conn.cursor() as cursor:
                await cursor.executemany(
                    """INSERT INTO public.netskope_office_experience_days
                           (event_day, email_key, office_minutes, office_score, remote_minutes, remote_score, source_run_id)
                       VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                    [(day, row["email"], row["office_minutes"], row["office_score"], row["remote_minutes"], row["remote_score"], run_id) for row in rows],
                )
            await conn.execute(
                """INSERT INTO public.netskope_office_experience_measured (event_day, people, failed_calls, source_run_id)
                   VALUES (%s, %s, %s, %s)
                   ON CONFLICT (event_day) DO UPDATE SET people = EXCLUDED.people, failed_calls = EXCLUDED.failed_calls,
                       source_run_id = EXCLUDED.source_run_id, measured_at = now()""",
                (day, len(rows), failed_calls, run_id),
            )
            for table in ("netskope_office_experience_days", "netskope_office_experience_measured"):
                await conn.execute(f"DELETE FROM public.{table} WHERE event_day < %s::date - %s", (day, RETENTION_DAYS))


async def office_experience_rows(pool: AsyncConnectionPool, first: date, last: date) -> list[dict[str, Any]]:
    """Measured rows in [first, last] with the person's name and company when exactly one active user has that email."""
    return await fetch_all(
        pool,
        f"""SELECT e.event_day, e.email_key AS email, e.office_minutes, e.office_score, e.remote_minutes, e.remote_score,
                   n.display_name AS name, n.company
            FROM public.netskope_office_experience_days e
            LEFT JOIN LATERAL (
                SELECT min(o.display_name) AS display_name,
                       min({_bucket(USER_COMPANY.replace('attributes', 'o.attributes'))}) AS company
                FROM public.cyberark_inventory_objects o
                WHERE o.source_system = %s AND o.object_type = 'user' AND o.lifecycle_status = 'active'
                  AND {person_email_sql("o.attributes->>'email'")} = e.email_key
                HAVING count(*) = 1
            ) n ON TRUE
            WHERE e.event_day BETWEEN %s AND %s""",
        (SOURCE_SYSTEM, first, last),
    )


OFFICE_TASK_KEY = "netskope_office_experience"


async def latest_office_run(pool: AsyncConnectionPool) -> dict[str, Any] | None:
    """The newest run of the office measurement task (queued, running, completed or failed), if any."""
    rows = await fetch_all(
        pool,
        """SELECT status, started_at, completed_at FROM public.cyberark_ingestion_runs
           WHERE source_system = %s AND task_key = %s
           ORDER BY coalesce(started_at, created_at) DESC LIMIT 1""",
        (SOURCE_SYSTEM, OFFICE_TASK_KEY),
    )
    return rows[0] if rows else None


async def measured_office_days(pool: AsyncConnectionPool, first: date, last: date) -> list[dict[str, Any]]:
    return await fetch_all(
        pool,
        """SELECT event_day, people, failed_calls, measured_at FROM public.netskope_office_experience_measured
           WHERE event_day BETWEEN %s AND %s ORDER BY event_day""",
        (first, last),
    )


async def person_presence_days(pool: AsyncConnectionPool, email: str, first: date, last: date) -> list[dict[str, Any]]:
    """Per UTC day, whether any of the person's active devices reported on-prem and/or off-prem."""
    return await fetch_all(
        pool,
        f"""SELECT p.event_day, bool_or(p.onprem_status = 'on-prem') AS office, bool_or(p.onprem_status = 'off-prem') AS remote
            {_PERSON_DEVICES}
            WHERE {_EMAIL} = %s AND p.event_day BETWEEN %s AND %s
            GROUP BY 1 ORDER BY 1""",
        (SOURCE_SYSTEM, email, first, last),
    )


async def person_office_rows(pool: AsyncConnectionPool, email: str, first: date, last: date) -> list[dict[str, Any]]:
    return await fetch_all(
        pool,
        """SELECT event_day, office_minutes, office_score, remote_minutes, remote_score
           FROM public.netskope_office_experience_days
           WHERE email_key = %s AND event_day BETWEEN %s AND %s ORDER BY event_day""",
        (email, first, last),
    )


# NSK-EXP-OFFICE-002: each measured person's company, resolved once per email (not once per row) as in
# office_experience_rows; no unique active user means NULL, shown as "Sin empresa".
_TIMELINE_PEOPLE = f"""
    WITH people AS (
        SELECT DISTINCT email_key FROM public.netskope_office_experience_days WHERE event_day BETWEEN %s AND %s
    ), named AS (
        SELECT p.email_key, n.company
        FROM people p
        LEFT JOIN LATERAL (
            SELECT min({_bucket(USER_COMPANY.replace('attributes', 'o.attributes'))}) AS company
            FROM public.cyberark_inventory_objects o
            WHERE o.source_system = %s AND o.object_type = 'user' AND o.lifecycle_status = 'active'
              AND {person_email_sql("o.attributes->>'email'")} = p.email_key
            HAVING count(*) = 1
        ) n ON TRUE
    )
"""


async def office_timeline_days(
    pool: AsyncConnectionPool, first: date, last: date, company: str | None, no_company: str,
) -> list[dict[str, Any]]:
    """Per measured day, the average score per person (each person weighs the same) in the office and remote,
    with how many people each average covers; only for one company when given."""
    return await fetch_all(
        pool,
        f"""{_TIMELINE_PEOPLE}
            SELECT e.event_day,
                   avg(e.office_score)::float AS office_avg, count(e.office_score) AS office_people,
                   avg(e.remote_score)::float AS remote_avg, count(e.remote_score) AS remote_people
            FROM public.netskope_office_experience_days e
            JOIN named USING (email_key)
            WHERE e.event_day BETWEEN %s AND %s
              AND (%s::text IS NULL OR coalesce(named.company, %s) = %s)
            GROUP BY e.event_day ORDER BY e.event_day""",
        (first, last, SOURCE_SYSTEM, first, last, company, no_company, company),
    )


async def office_timeline_companies(pool: AsyncConnectionPool, first: date, last: date, no_company: str) -> list[dict[str, Any]]:
    """Companies with measured people in [first, last], largest first, for the filter."""
    return await fetch_all(
        pool,
        f"""{_TIMELINE_PEOPLE}
            SELECT coalesce(company, %s) AS company, count(*) AS people
            FROM named GROUP BY 1 ORDER BY 2 DESC, 1""",
        (first, last, SOURCE_SYSTEM, no_company),
    )


async def office_person_identity(pool: AsyncConnectionPool, email: str) -> dict[str, Any] | None:
    """Name and company of the one active user with exactly this email, if exactly one."""
    rows = await fetch_all(
        pool,
        f"""SELECT min(o.display_name) AS name, min({_bucket(USER_COMPANY.replace('attributes', 'o.attributes'))}) AS company
            FROM public.cyberark_inventory_objects o
            WHERE o.source_system = %s AND o.object_type = 'user' AND o.lifecycle_status = 'active'
              AND {person_email_sql("o.attributes->>'email'")} = %s
            HAVING count(*) = 1""",
        (SOURCE_SYSTEM, email),
    )
    return rows[0] if rows else None
