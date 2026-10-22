"""Latest UCI per Netskope user, replaced as a whole by a complete read (NSK-UBA-002)."""

from collections.abc import Sequence
from typing import Any
from uuid import UUID

from psycopg_pool import AsyncConnectionPool

from app.cross.services.person_email_matching import person_email_sql
from app.db import fetch_all, fetch_one
from app.netskope.sse.repositories.netskope_shared import MISSING_VALUE, SOURCE_SYSTEM, USER_COMPANY, _bucket

COMPANY_LIMIT = 25

_ORDER = {"score": "u.score ASC, u.email_key", "name": "lower(coalesce(n.display_name, u.email_key)), u.email_key"}


async def replace_netskope_user_uci(pool: AsyncConnectionPool, run_id: UUID, rows: Sequence[dict[str, Any]]) -> None:
    """Swap the table contents in one transaction: users no longer Poor/Moderate drop out."""
    params = [
        (r["email_key"], r["rating"], r["score"], r.get("previous_score"), r["scored_at"], run_id)
        for r in rows
    ]
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                await cursor.execute("DELETE FROM public.netskope_user_uci")
                if params:
                    await cursor.executemany(
                        """
                        INSERT INTO public.netskope_user_uci
                            (email_key, rating, score, previous_score, scored_at, source_run_id)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        """,
                        params,
                    )


async def list_netskope_user_uci(
    pool: AsyncConnectionPool, rating: str, search: str, order: str, limit: int, offset: int, company: str = "",
) -> dict[str, Any]:
    """Rows joined to the active Netskope user with that exact email, when exactly one exists."""
    like = f"%{search.lower()}%"
    join = f"""
        FROM public.netskope_user_uci u
        LEFT JOIN LATERAL (
            SELECT min(o.source_id) AS user_id, min(o.display_name) AS display_name,
                   min({_bucket(USER_COMPANY.replace('attributes', 'o.attributes'))}) AS company
            FROM public.cyberark_inventory_objects o
            WHERE o.source_system = 'netskope' AND o.object_type = 'user' AND o.lifecycle_status = 'active'
              AND {person_email_sql("o.attributes->>'email'")} = u.email_key
            HAVING count(*) = 1
        ) n ON TRUE
        WHERE (%s = '' OR u.rating = %s) AND (%s = '' OR u.email_key LIKE %s OR lower(coalesce(n.display_name, '')) LIKE %s)
          AND (%s = '' OR n.company = %s)
    """
    params = (rating, rating, search, like, like, company, company)
    summary = await fetch_one(pool, """
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE u.rating = 'Poor')::int AS poor,
               count(*) FILTER (WHERE u.rating = 'Moderate')::int AS moderate,
               max(u.updated_at) AS captured_at
        FROM public.netskope_user_uci u
    """, ())
    filtered = await fetch_one(pool, f"SELECT count(*)::int AS total {join}", params)
    rows = await fetch_all(pool, f"""
        SELECT u.email_key AS email, n.user_id, n.display_name AS name, n.company, u.rating, u.score,
               u.previous_score, u.scored_at
        {join} ORDER BY {_ORDER.get(order, _ORDER['score'])} LIMIT %s OFFSET %s
    """, (*params, limit, offset))
    return {
        "rows": rows, "total": filtered["total"],
        "by_rating": {"Poor": summary["poor"], "Moderate": summary["moderate"]},
        "captured_at": summary["captured_at"],
    }


HISTORY_WEEKS = 26


async def _company_counts(pool: AsyncConnectionPool) -> list[dict[str, Any]]:
    email = person_email_sql("o.attributes->>'email'")
    return await fetch_all(pool, f"""
        SELECT {_bucket(USER_COMPANY.replace('attributes', 'o.attributes'))} AS company,
               count(DISTINCT {email})::int AS users,
               count(DISTINCT {email}) FILTER (WHERE u.rating = 'Poor')::int AS poor,
               count(DISTINCT {email}) FILTER (WHERE u.rating = 'Moderate')::int AS moderate
        FROM public.cyberark_inventory_objects o
        LEFT JOIN public.netskope_user_uci u ON u.email_key = {email}
        WHERE o.source_system = %s AND o.object_type = 'user' AND o.lifecycle_status = 'active'
          AND {email} <> ''
        GROUP BY 1
    """, (SOURCE_SYSTEM,))


async def record_uci_company_snapshot(pool: AsyncConnectionPool) -> int:
    """Upsert this week's per-company counts (counts only) and purge what is older than 26 weeks."""
    rows = await _company_counts(pool)
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                await cursor.execute("SELECT date_trunc('week', now() AT TIME ZONE 'UTC')::date AS week_start")
                week_start = (await cursor.fetchone())["week_start"]
                if rows:
                    await cursor.executemany(
                        """
                        INSERT INTO public.netskope_uci_company_history (week_start, company, users, poor, moderate)
                        VALUES (%s, %s, %s, %s, %s)
                        ON CONFLICT (week_start, company) DO UPDATE
                        SET users = EXCLUDED.users, poor = EXCLUDED.poor, moderate = EXCLUDED.moderate, captured_at = now()
                        """,
                        [(week_start, r["company"], r["users"], r["poor"], r["moderate"]) for r in rows],
                    )
                await cursor.execute(
                    "DELETE FROM public.netskope_uci_company_history WHERE week_start < %s::date - (%s * 7)",
                    (week_start, HISTORY_WEEKS),
                )
    return len(rows)


async def uci_by_company(pool: AsyncConnectionPool) -> dict[str, Any]:
    """Share of each company's active users whose UCI is Poor or Moderate, with last week's counts.

    Good users are not stored, so this is a proportion over the company's active
    users with an email (the only key that links to the UCI), never an average
    score. Companies are ranked by that share; the rest are summed in ``omitted_users``.
    ``previous`` comes from the latest weekly snapshot before the current week, or None.
    """
    rows = await _company_counts(pool)
    previous_rows = await fetch_all(pool, """
        SELECT company, users, poor, moderate, week_start FROM public.netskope_uci_company_history
        WHERE week_start = (
            SELECT max(week_start) FROM public.netskope_uci_company_history
            WHERE week_start < date_trunc('week', now() AT TIME ZONE 'UTC')::date
        )
    """, ())
    previous = {r["company"]: r for r in previous_rows}
    ranked = sorted(rows, key=lambda r: (-((r["poor"] + r["moderate"]) / r["users"] if r["users"] else 0), -r["users"], r["company"]))
    shown = []
    for row in ranked[:COMPANY_LIMIT]:
        before = previous.get(row["company"])
        shown.append({**row, "previous": {"users": before["users"], "poor": before["poor"], "moderate": before["moderate"]} if before else None})
    return {
        "companies": shown,
        "omitted_users": sum(r["users"] for r in ranked[COMPANY_LIMIT:]),
        "previous_week": previous_rows[0]["week_start"] if previous_rows else None,
        "unassigned": MISSING_VALUE,
    }
