"""Read-only person view across the integrated tools (CHAIN-010, Fase F).

The person key is the normalized email. Each tool resolves its own object with
the sanctioned ``person_email_matching`` rule (exact ``lower(btrim())``, 1 to
1, human PAM users only) and publishes a summary built exclusively from
persisted data. Nothing is persisted, no cross-source relationship is drawn,
and a tool never appears for an actor who cannot read its source.
"""

from psycopg_pool import AsyncConnectionPool

from app.db import fetch_all, fetch_one
from app.cyberark.identity_administration.services.identity_federation_resolution import resolve_expected_federation
from app.cross.services.person_email_matching import (
    PERSON_EMAIL_SHAPE_SQL,
    is_excluded_person_email_domain,
    normalize_person_email,
    pam_human_user_sql,
    person_email_domain_exclusion_sql,
    person_email_sql,
    resolve_unique,
)
from app.cyberark.identity_administration.repositories.identity_admin_queries import list_active_federations
from app.netskope.sse.repositories.netskope_chain_expand import user_matched_device_summary
from app.netskope.sse.repositories.netskope_shared import USER_COMPANY
from app.cyberark.pam.repositories.pam_chain_queries import get_pam_chain_for_user
from app.cross.repositories.person_role_access import pam_access_through_identity_roles, sia_access_for_person

PAM_SOURCE_SYSTEM = "cyberark"
IDENTITY_SOURCE_SYSTEM = "identity_administration"
NETSKOPE_SOURCE_SYSTEM = "netskope"

# Canonical order for merging and for the per-person source list.
SOURCE_ORDER = ("pam", "identity", "netskope")
PERSON_SEARCH_LIMIT = 20
EMAIL_EXACT = "email_exact"
DISPLAY_NAME_REFERENCE = "display_name_reference_only"


def _like_pattern(query: str) -> str:
    escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


async def _search_pam(pool: AsyncConnectionPool, like: str, limit: int) -> list[dict]:
    return await fetch_all(pool, f"""
        SELECT u.display_name AS name, {person_email_sql("u.source_id")} AS email
        FROM public.cyberark_inventory_objects u
        WHERE u.source_system = %s AND u.object_type = 'user' AND u.lifecycle_status = 'active'
          AND ({pam_human_user_sql("u")})
          AND ({person_email_sql("u.source_id")} ILIKE %s OR u.display_name ILIKE %s)
        ORDER BY lower(u.display_name), u.object_id
        LIMIT %s
    """, (PAM_SOURCE_SYSTEM, like, like, limit))


async def _search_identity(pool: AsyncConnectionPool, like: str, limit: int) -> list[dict]:
    return await fetch_all(pool, f"""
        SELECT o.display_name AS name, {person_email_sql("o.attributes->>'email'")} AS email
        FROM public.cyberark_inventory_objects o
        WHERE o.source_system = %s AND o.object_type = 'user' AND o.lifecycle_status = 'active'
          AND coalesce((o.attributes->>'service_user')::boolean, false) = false
          AND {person_email_sql("o.attributes->>'email'")} ~ {PERSON_EMAIL_SHAPE_SQL}
          AND {person_email_domain_exclusion_sql("o.attributes->>'email'")}
          AND ({person_email_sql("o.attributes->>'email'")} ILIKE %s OR o.display_name ILIKE %s)
        ORDER BY lower(o.display_name), o.object_id
        LIMIT %s
    """, (IDENTITY_SOURCE_SYSTEM, like, like, limit))


async def _search_netskope(pool: AsyncConnectionPool, like: str, limit: int) -> list[dict]:
    return await fetch_all(pool, f"""
        SELECT o.display_name AS name, {person_email_sql("o.attributes->>'email'")} AS email
        FROM public.cyberark_inventory_objects o
        WHERE o.source_system = %s AND o.object_type = 'user' AND o.lifecycle_status = 'active'
          AND {person_email_sql("o.attributes->>'email'")} ~ {PERSON_EMAIL_SHAPE_SQL}
          AND {person_email_domain_exclusion_sql("o.attributes->>'email'")}
          AND ({person_email_sql("o.attributes->>'email'")} ILIKE %s OR o.display_name ILIKE %s)
        ORDER BY lower(o.display_name), o.object_id
        LIMIT %s
    """, (NETSKOPE_SOURCE_SYSTEM, like, like, limit))


_SEARCHERS = {"pam": _search_pam, "identity": _search_identity, "netskope": _search_netskope}


def _merge_people(rows_by_source: dict[str, list[dict]], limit: int) -> list[dict]:
    """Merge per-source rows into people keyed by normalized email.

    Two people with the same name and different email are two results; nothing
    is ever grouped by name.
    """
    people: dict[str, dict] = {}
    order: list[str] = []
    for source in SOURCE_ORDER:
        for row in rows_by_source.get(source, []):
            email = normalize_person_email(row["email"])
            if email is None or is_excluded_person_email_domain(email):
                continue
            person = people.get(email)
            if person is None:
                person = {"email": email, "name": "", "sources": []}
                people[email] = person
                order.append(email)
            name = str(row["name"] or "").strip()
            if not person["name"] and name:
                person["name"] = name
            if source not in person["sources"]:
                person["sources"].append(source)
    result = [people[email] for email in order]
    result.sort(key=lambda person: (person["name"].lower(), person["email"]))
    return result[:limit]


async def search_person_candidates(
    pool: AsyncConnectionPool,
    *,
    query: str,
    sources: set[str],
    limit: int = PERSON_SEARCH_LIMIT,
) -> dict:
    like = _like_pattern(query)
    rows_by_source: dict[str, list[dict]] = {}
    for source in SOURCE_ORDER:
        if source in sources:
            rows_by_source[source] = await _SEARCHERS[source](pool, like, limit)
    return {"query": query, "people": _merge_people(rows_by_source, limit)}


async def _pam_summary(pool: AsyncConnectionPool, email: str) -> dict:
    candidates = await fetch_all(pool, f"""
        SELECT u.object_id, u.display_name, u.source_id, u.attributes
        FROM public.cyberark_inventory_objects u
        WHERE u.source_system = %s AND u.object_type = 'user' AND u.lifecycle_status = 'active'
          AND {person_email_sql("u.source_id")} = %s
          AND ({pam_human_user_sql("u")})
        ORDER BY u.object_id
    """, (PAM_SOURCE_SYSTEM, email))
    resolution = resolve_unique(candidates)
    if resolution["status"] != "matched":
        return {"status": resolution["status"]}
    user = resolution["match"]
    attributes = user.get("attributes") or {}
    chain = await get_pam_chain_for_user(pool, user)
    return {
        "status": "matched",
        "basis": EMAIL_EXACT,
        "user": {
            "object_id": user["object_id"],
            "display_name": user["display_name"],
            "source_id": user["source_id"],
            "user_type": str(attributes.get("user_type") or ""),
            "suspended": str(attributes.get("suspended") or "").lower() == "true",
        },
        "totals": chain["totals"],
    }


async def _identity_summary(pool: AsyncConnectionPool, email: str) -> dict:
    candidates = await fetch_all(pool, f"""
        SELECT o.object_id, o.display_name, o.source_id, o.attributes
        FROM public.cyberark_inventory_objects o
        WHERE o.source_system = %s AND o.object_type = 'user' AND o.lifecycle_status = 'active'
          AND {person_email_sql("o.attributes->>'email'")} = %s
          AND coalesce((o.attributes->>'service_user')::boolean, false) = false
          AND {person_email_sql("o.attributes->>'email'")} ~ {PERSON_EMAIL_SHAPE_SQL}
          AND {person_email_domain_exclusion_sql("o.attributes->>'email'")}
        ORDER BY o.object_id
    """, (IDENTITY_SOURCE_SYSTEM, email))
    resolution = resolve_unique(candidates)
    if resolution["status"] != "matched":
        return {"status": resolution["status"]}
    user = resolution["match"]
    attributes = user.get("attributes") or {}
    role_row = await fetch_one(pool, """
        SELECT count(*)::int AS total
        FROM public.cyberark_inventory_relationships r
        JOIN public.cyberark_inventory_objects ro
          ON ro.object_id = r.target_object_id AND ro.lifecycle_status = 'active'
        WHERE r.source_object_id = %s
          AND r.relationship_type = 'user_has_role' AND r.lifecycle_status = 'active'
    """, (user["object_id"],))
    federations = await list_active_federations(pool)
    federation = resolve_expected_federation(attributes.get("email"), federations)
    federation_payload = None
    if federation.get("status") == "matched" and federation.get("object_id") is not None:
        federation_payload = {
            "object_id": federation["object_id"],
            "display_name": federation["display_name"] or "",
            "source_id": federation["source_id"] or "",
        }
    return {
        "status": "matched",
        "basis": EMAIL_EXACT,
        "user": {
            "object_id": user["object_id"],
            "display_name": user["display_name"],
            "source_id": user["source_id"],
            "active": str(attributes.get("active") or "").lower() == "true",
            "last_login_date": str(attributes.get("last_login_date") or ""),
        },
        "federation": federation_payload,
        "role_count": role_row["total"] if role_row else 0,
    }


async def _netskope_summary(pool: AsyncConnectionPool, email: str) -> dict:
    candidates = await fetch_all(pool, f"""
        SELECT o.object_id, o.display_name, o.source_id, o.attributes,
               {person_email_sql("o.attributes->>'email'")} AS email,
               {USER_COMPANY} AS company
        FROM public.cyberark_inventory_objects o
        WHERE o.source_system = %s AND o.object_type = 'user' AND o.lifecycle_status = 'active'
          AND {person_email_sql("o.attributes->>'email'")} = %s
          AND {person_email_sql("o.attributes->>'email'")} ~ {PERSON_EMAIL_SHAPE_SQL}
          AND {person_email_domain_exclusion_sql("o.attributes->>'email'")}
        ORDER BY o.object_id
    """, (NETSKOPE_SOURCE_SYSTEM, email))
    resolution = resolve_unique(candidates)
    if resolution["status"] != "matched":
        return {"status": resolution["status"]}
    user = resolution["match"]
    summary = await user_matched_device_summary(pool, user)
    return {
        "status": "matched",
        "basis": EMAIL_EXACT,
        "user": {
            "object_id": user["object_id"],
            "display_name": user["display_name"],
            "source_id": user["source_id"],
        },
        "company": str(user.get("company") or ""),
        **summary,
    }


async def _sia_summary(pool: AsyncConnectionPool, *, identity_user_object_id: int | None, pam_user_name: str | None) -> dict:
    access = await sia_access_for_person(
        pool, identity_user_object_id=identity_user_object_id, pam_user_name=pam_user_name,
    )
    return {
        "status": "reference",
        "basis": DISPLAY_NAME_REFERENCE,
        "policy_count": access["policies"],
        "sia_access": access,
    }


async def get_person_summary(
    pool: AsyncConnectionPool,
    *,
    email: str,
    sources: set[str],
) -> dict:
    """Per-tool summaries for one normalized email, only readable tools."""
    tools: dict[str, dict] = {}
    pam_summary = await _pam_summary(pool, email) if "pam" in sources else None
    if pam_summary is not None:
        tools["pam"] = pam_summary
    if "identity" in sources:
        tools["identity"] = await _identity_summary(pool, email)
    # Sanctioned exception (2026-10-05): without a PAM user of their own, a person
    # can still reach Safes through an Identity role linked by exact unique name.
    # Only when both PAM and Identity are readable; never for an ambiguous PAM match.
    identity_summary = tools.get("identity")
    if (pam_summary is not None and pam_summary["status"] == "unmatched"
            and identity_summary and identity_summary["status"] == "matched"):
        pam_summary["role_access"] = await pam_access_through_identity_roles(pool, identity_summary["user"]["object_id"])
    if "netskope" in sources:
        tools["netskope"] = await _netskope_summary(pool, email)
    # SIA has no user object: its policies name grantees by user and Identity
    # role name (sanctioned exception, 2026-10-05). It only adds a name reference
    # when a PAM user or a readable Identity user was resolved.
    if "sia" in sources:
        pam_user_name = pam_summary["user"]["display_name"] if pam_summary and pam_summary["status"] == "matched" else None
        identity_user_id = (identity_summary["user"]["object_id"]
                            if identity_summary and identity_summary["status"] == "matched" else None)
        if pam_user_name or identity_user_id is not None:
            tools["sia"] = await _sia_summary(
                pool, identity_user_object_id=identity_user_id, pam_user_name=pam_user_name,
            )
    return {"email": email, "name": _person_name(tools), "tools": tools}


def _person_name(tools: dict[str, dict]) -> str:
    """A human name for the person, never an email echoed back as a name.

    PAM user names are usually the login email itself, so Identity and
    Netskope display names come first; a value with an ``@`` is skipped.
    """
    for source in ("identity", "netskope", "pam"):
        tool = tools.get(source)
        if not tool or tool.get("status") != "matched" or not tool.get("user"):
            continue
        name = str(tool["user"].get("display_name") or "").strip()
        if name and "@" not in name:
            return name
    return ""
