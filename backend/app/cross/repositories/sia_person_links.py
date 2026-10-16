"""Read-only exact-email resolution for SIA policy user grantees (REL-001)."""

from collections import defaultdict
from collections.abc import Iterable

from psycopg_pool import AsyncConnectionPool

from app.db import fetch_all
from app.cross.services.person_email_matching import (
    PERSON_EMAIL_SHAPE_SQL,
    is_excluded_person_email_domain,
    normalize_person_email,
    pam_human_user_sql,
    person_email_domain_exclusion_sql,
    person_email_sql,
    resolve_unique,
)

IDENTITY_SOURCE_SYSTEM = "identity_administration"
PAM_SOURCE_SYSTEM = "cyberark"


async def _identity_candidates(pool: AsyncConnectionPool, emails: list[str]) -> list[dict]:
    return await fetch_all(pool, f"""
        SELECT o.object_id, o.display_name,
               {person_email_sql("o.attributes->>'email'")} AS email
        FROM public.cyberark_inventory_objects o
        WHERE o.source_system = %s AND o.object_type = 'user'
          AND o.lifecycle_status = 'active'
          AND {person_email_sql("o.attributes->>'email'")} = ANY(%s)
          AND {person_email_sql("o.attributes->>'email'")} ~ {PERSON_EMAIL_SHAPE_SQL}
          AND {person_email_domain_exclusion_sql("o.attributes->>'email'")}
          AND coalesce((o.attributes->>'service_user')::boolean, false) = false
        ORDER BY o.object_id
    """, (IDENTITY_SOURCE_SYSTEM, emails))


async def _pam_candidates(pool: AsyncConnectionPool, emails: list[str]) -> list[dict]:
    return await fetch_all(pool, f"""
        SELECT u.object_id, u.display_name,
               {person_email_sql("u.source_id")} AS email
        FROM public.cyberark_inventory_objects u
        WHERE u.source_system = %s AND u.object_type = 'user'
          AND u.lifecycle_status = 'active'
          AND {person_email_sql("u.source_id")} = ANY(%s)
          AND ({pam_human_user_sql("u")})
        ORDER BY u.object_id
    """, (PAM_SOURCE_SYSTEM, emails))


def _grantee_values(grantees: object) -> list[tuple[str, str | None]]:
    """Keep first original value while deduplicating valid emails normalized."""
    if not isinstance(grantees, list):
        return []
    values: list[tuple[str, str | None]] = []
    seen: set[tuple[str, str]] = set()
    for value in grantees:
        if not isinstance(value, str):
            continue
        email = normalize_person_email(value)
        key = ("email", email) if email is not None else ("raw", value)
        if key in seen:
            continue
        seen.add(key)
        values.append((value, email))
    return values


def _resolutions(rows: Iterable[dict]) -> dict[str, dict]:
    candidates: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        candidates[row["email"]].append(row)
    result: dict[str, dict] = {}
    for email, matches in candidates.items():
        resolution = resolve_unique(matches)
        side = {"status": resolution["status"]}
        if resolution["status"] == "matched":
            user = resolution["match"]
            side["match"] = {
                "object_id": user["object_id"],
                "display_name": user["display_name"],
            }
        result[email] = side
    return result


async def resolve_sia_policy_grantees(
    pool: AsyncConnectionPool,
    policies: list[dict],
    *,
    readable_sides: set[str],
) -> list[dict]:
    """Attach independently resolved Identity/PAM states to a policy page.

    At most one set-based query is issued per readable side, regardless of the
    number of policy grantees. Unauthorized sides are neither queried nor
    included in the response.
    """
    values_by_policy: list[list[tuple[str, str | None]]] = []
    requested_emails: set[str] = set()
    for policy in policies:
        attributes = policy.get("attributes") or {}
        values = _grantee_values(attributes.get("granted_users"))
        values_by_policy.append(values)
        requested_emails.update(
            email for _, email in values
            if email is not None and not is_excluded_person_email_domain(email)
        )
    emails = sorted(requested_emails)

    identity_resolutions: dict[str, dict] = {}
    pam_resolutions: dict[str, dict] = {}
    if emails and "identity" in readable_sides:
        identity_resolutions = _resolutions(await _identity_candidates(pool, emails))
    if emails and "pam" in readable_sides:
        pam_resolutions = _resolutions(await _pam_candidates(pool, emails))

    enriched: list[dict] = []
    for policy, values in zip(policies, values_by_policy, strict=True):
        links = []
        for original, email in values:
            link: dict = {"value": original}
            excluded = email is None or is_excluded_person_email_domain(email)
            if "identity" in readable_sides:
                link["identity"] = (
                    {"status": "unmatched"} if excluded
                    else identity_resolutions.get(email, {"status": "unmatched"})
                )
            if "pam" in readable_sides:
                link["pam"] = (
                    {"status": "unmatched"} if excluded
                    else pam_resolutions.get(email, {"status": "unmatched"})
                )
            links.append(link)
        enriched.append({**policy, "grantee_links": links})
    return enriched
