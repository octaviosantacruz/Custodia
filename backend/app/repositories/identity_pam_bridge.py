"""Sanctioned cross-source read: Identity Administration user -> PAM chain.

This is the only module that matches identity_administration to cyberark. The
match is exact source_id equality (the shared CyberArk Identity UUID), never a
name, email or heuristic. After that deterministic match, traversal delegates
to the single-source PAM query in pam_chain_queries.py. It is read-only and
does not feed coverage or KPIs. See docs/architecture/integration-contracts.md.
"""

from psycopg_pool import AsyncConnectionPool

from ..db import fetch_all, fetch_one
from .pam_chain_queries import (
    BRIDGE_PLATFORM_PREVIEW,
    BRIDGE_ROLE_LIMIT,
    BRIDGE_SAFE_PREVIEW,
    PAM_SOURCE_SYSTEM,
    empty_pam_chain,
    get_pam_chain_for_user,
    standard_seat_sql,
)


async def list_standard_seat_source_ids(pool: AsyncConnectionPool) -> list[str]:
    """PAM UUIDs with Standard-seat evidence. Matched later by exact source_id."""
    rows = await fetch_all(pool, f"""
        SELECT u.source_id
        FROM public.cyberark_inventory_objects u
        WHERE u.source_system = %s AND u.object_type = 'user'
          AND u.lifecycle_status = 'active'
          AND ({standard_seat_sql("u")})
    """, (PAM_SOURCE_SYSTEM,))
    return [row["source_id"] for row in rows]


async def annotate_identity_standard_seats(pool: AsyncConnectionPool, rows: list[dict]) -> list[dict]:
    """Mark Identity rows whose source_id equals a PAM Standard-seat UUID."""
    source_ids = [row["source_id"] for row in rows if row.get("source_id")]
    matched: set[str] = set()
    if source_ids:
        found = await fetch_all(pool, f"""
            SELECT u.source_id
            FROM public.cyberark_inventory_objects u
            WHERE u.source_system = %s AND u.object_type = 'user'
              AND u.lifecycle_status = 'active'
              AND u.source_id = ANY(%s)
              AND ({standard_seat_sql("u")})
        """, (PAM_SOURCE_SYSTEM, source_ids))
        matched = {row["source_id"] for row in found}
    for row in rows:
        row["standard_seat_reconciled"] = row.get("source_id") in matched
    return rows


async def get_identity_user_pam_chain(pool: AsyncConnectionPool, identity_source_id: str) -> dict:
    pam_user = await fetch_one(pool, """
        SELECT object_id, display_name, source_id
        FROM public.cyberark_inventory_objects
        WHERE source_system = %s AND object_type = 'user'
          AND lifecycle_status = 'active' AND source_id = %s
    """, (PAM_SOURCE_SYSTEM, identity_source_id))
    if pam_user is None:
        return empty_pam_chain()
    return await get_pam_chain_for_user(
        pool,
        pam_user,
        role_limit=BRIDGE_ROLE_LIMIT,
        safe_limit=BRIDGE_SAFE_PREVIEW,
        platform_limit=BRIDGE_PLATFORM_PREVIEW,
    )
