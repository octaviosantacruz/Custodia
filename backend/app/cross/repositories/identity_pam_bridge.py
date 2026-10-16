"""Sanctioned cross-source read: Identity Administration user -> PAM chain.

This is the only module that matches identity_administration to cyberark. The
chain traversal keeps the exact source_id rule; Standard-seat presentation may
also use an exact, normalized email match when it is unique on the PAM side.
It is read-only and does not feed coverage or KPIs. See
docs/architecture/integration-contracts.md.
"""

from psycopg_pool import AsyncConnectionPool

from app.db import fetch_all, fetch_one
from app.cross.services.person_email_matching import (
    PERSON_EMAIL_SHAPE_SQL,
    normalize_person_email,
    pam_human_user_sql,
    person_email_sql,
    resolve_unique,
)
from app.cyberark.pam.repositories.pam_chain_queries import (
    BRIDGE_PLATFORM_PREVIEW,
    BRIDGE_ROLE_LIMIT,
    BRIDGE_SAFE_PREVIEW,
    PAM_SOURCE_SYSTEM,
    empty_pam_chain,
    get_pam_chain_for_user,
    standard_seat_sql,
)

IDENTITY_SOURCE_SYSTEM = "identity_administration"


async def list_standard_seat_emails(pool: AsyncConnectionPool) -> list[str]:
    """Unique PAM email usernames with Standard-seat evidence.

    Standard seat keeps its own eligibility (``standard_seat_sql``); it only
    borrows the email normalization primitives, so its result is unchanged.
    """
    rows = await fetch_all(pool, f"""
        SELECT {person_email_sql("u.display_name")} AS email
        FROM public.cyberark_inventory_objects u
        WHERE u.source_system = %s AND u.object_type = 'user'
          AND u.lifecycle_status = 'active'
          AND position('@' IN u.display_name) > 1
          AND ({standard_seat_sql("u")})
        GROUP BY {person_email_sql("u.display_name")}
        HAVING count(*) = 1
    """, (PAM_SOURCE_SYSTEM,))
    return [row["email"] for row in rows]


async def annotate_identity_standard_seats(pool: AsyncConnectionPool, rows: list[dict]) -> list[dict]:
    """Mark Identity rows whose email exactly matches a unique PAM seat user."""
    emails = [normalize_person_email(str(row.get("attributes", {}).get("email", ""))) for row in rows]
    emails = [email for email in emails if email]
    matched: set[str] = set()
    if emails:
        found = await fetch_all(pool, f"""
            SELECT {person_email_sql("u.display_name")} AS email
            FROM public.cyberark_inventory_objects u
            WHERE u.source_system = %s AND u.object_type = 'user'
              AND u.lifecycle_status = 'active'
              AND {person_email_sql("u.display_name")} = ANY(%s)
              AND ({standard_seat_sql("u")})
            GROUP BY {person_email_sql("u.display_name")}
            HAVING count(*) = 1
        """, (PAM_SOURCE_SYSTEM, emails))
        matched = {row["email"] for row in found}
    for row in rows:
        email = normalize_person_email(str(row.get("attributes", {}).get("email", "")))
        row["standard_seat_reconciled"] = email is not None and email in matched
    return rows


async def resolve_identity_pam_user(
    pool: AsyncConnectionPool,
    identity_source_id: str,
    identity_email: str | None = None,
) -> dict:
    """Resolve the PAM counterpart: exact UUID first, then exact email 1-to-1.

    Returns ``{status, match_basis, pam_user}`` and never invents a link.
    """
    pam_user = await fetch_one(pool, """
        SELECT object_id, display_name, source_id
        FROM public.cyberark_inventory_objects
        WHERE source_system = %s AND object_type = 'user'
          AND lifecycle_status = 'active' AND source_id = %s
    """, (PAM_SOURCE_SYSTEM, identity_source_id))
    if pam_user is not None:
        return {"status": "matched", "match_basis": "uuid", "pam_user": pam_user}

    email = normalize_person_email(identity_email)
    if email is None:
        return {"status": "unmatched", "match_basis": None, "pam_user": None}

    # D3 requires 1-to-1 on both sides: only another active Identity user
    # sharing the same email makes the link ambiguous. A count of 0 means the
    # current Identity object is not active (or its stored email differs), so
    # it must fall through to the PAM-side resolution instead of being
    # reported as ambiguous — that would both lie and hide a valid PAM link.
    identity_side = await fetch_one(pool, f"""
        SELECT count(*)::int AS total
        FROM public.cyberark_inventory_objects i
        WHERE i.source_system = %s AND i.object_type = 'user'
          AND i.lifecycle_status = 'active'
          AND {person_email_sql("i.attributes->>'email'")} = %s
    """, (IDENTITY_SOURCE_SYSTEM, email))
    if identity_side is not None and identity_side["total"] > 1:
        return {"status": "ambiguous", "match_basis": "email", "pam_user": None}

    candidates = await fetch_all(pool, f"""
        SELECT u.object_id, u.display_name, u.source_id
        FROM public.cyberark_inventory_objects u
        WHERE u.source_system = %s AND u.object_type = 'user'
          AND u.lifecycle_status = 'active'
          AND {person_email_sql("u.source_id")} = %s
          AND ({pam_human_user_sql("u")})
    """, (PAM_SOURCE_SYSTEM, email))
    resolution = resolve_unique(candidates)
    return {
        "status": resolution["status"],
        "match_basis": "email",
        "pam_user": resolution["match"],
    }


async def get_identity_user_pam_chain(
    pool: AsyncConnectionPool,
    identity_source_id: str,
    identity_email: str | None = None,
) -> dict:
    """Resolve the PAM counterpart by exact UUID first, then by exact email.

    The email rule is the sanctioned person-link exception: exact
    ``lower(btrim())`` equality, 1-to-1, human PAM users only. ``match_basis``
    and ``status`` are always published so the UI can label the link.
    """
    resolution = await resolve_identity_pam_user(pool, identity_source_id, identity_email)
    if resolution["status"] != "matched":
        return {**empty_pam_chain(), "match_basis": resolution["match_basis"], "status": resolution["status"]}
    chain = await _delegated_chain(pool, resolution["pam_user"])
    return {**chain, "match_basis": resolution["match_basis"], "status": "matched"}


async def _delegated_chain(pool: AsyncConnectionPool, pam_user: dict) -> dict:
    return await get_pam_chain_for_user(
        pool,
        pam_user,
        role_limit=BRIDGE_ROLE_LIMIT,
        safe_limit=BRIDGE_SAFE_PREVIEW,
        platform_limit=BRIDGE_PLATFORM_PREVIEW,
    )


async def identity_links_for_pam_users(
    pool: AsyncConnectionPool,
    pam_object_ids: list[int] | None = None,
) -> list[dict]:
    """Identity users linked to PAM users, with the link basis.

    Narrowed by PAM ``object_id`` (``None`` returns every link; volumes are
    small). Only equality lives here: name/email search is the caller's.

    Set-based twin of ``resolve_identity_pam_user`` (same rule, same order):
    an Identity user links by exact ``source_id`` first; only when no PAM user
    shares it does the exact-email rule apply, and only 1 to 1 on both sides
    with a human PAM counterpart. Used by the Relaciones chain so walking back
    from a PAM user never shows a link the forward resolution would not draw.
    """
    if pam_object_ids is not None and not pam_object_ids:
        return []
    return await fetch_all(pool, f"""
        WITH pam_users AS (
            SELECT u.object_id, u.source_id, {person_email_sql("u.source_id")} AS email,
                   ({pam_human_user_sql("u")}) AS human
            FROM public.cyberark_inventory_objects u
            WHERE u.source_system = %s AND u.object_type = 'user'
              AND u.lifecycle_status = 'active'
        ),
        pam_email_counts AS (
            SELECT email, count(*)::int AS total FROM pam_users WHERE human GROUP BY email
        ),
        identity_users AS (
            SELECT i.object_id, i.display_name, i.source_id,
                   {person_email_sql("i.attributes->>'email'")} AS email,
                   coalesce(i.attributes->>'email', '') AS raw_email
            FROM public.cyberark_inventory_objects i
            WHERE i.source_system = %s AND i.object_type = 'user'
              AND i.lifecycle_status = 'active'
        ),
        identity_email_counts AS (
            SELECT email, count(*)::int AS total FROM identity_users
            WHERE email ~ {PERSON_EMAIL_SHAPE_SQL} GROUP BY email
        ),
        links AS (
            SELECT p.object_id AS pam_object_id, i.object_id AS identity_object_id,
                   i.display_name, i.raw_email, 'uuid_exact' AS basis
            FROM pam_users p JOIN identity_users i ON i.source_id = p.source_id
            UNION ALL
            SELECT p.object_id, i.object_id, i.display_name, i.raw_email, 'email_exact'
            FROM pam_users p
            JOIN identity_users i ON i.email = p.email AND i.email ~ {PERSON_EMAIL_SHAPE_SQL}
            JOIN pam_email_counts pc ON pc.email = p.email AND pc.total = 1
            JOIN identity_email_counts ic ON ic.email = i.email AND ic.total = 1
            WHERE p.human
              AND NOT EXISTS (SELECT 1 FROM pam_users other WHERE other.source_id = i.source_id)
        )
        SELECT * FROM links
        WHERE (%s::bigint[] IS NULL OR pam_object_id = ANY(%s))
        ORDER BY lower(display_name), identity_object_id
    """, (
        PAM_SOURCE_SYSTEM, IDENTITY_SOURCE_SYSTEM,
        pam_object_ids, pam_object_ids,
    ))
