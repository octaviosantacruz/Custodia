"""PAM access reached through Identity roles (sanctioned exception, 2026-10-05).

A person without a PAM user of their own can still reach Safes through an
Identity Administration role. The two sources share no role identifier
(Identity uses UUIDs, PAM numeric member ids), so the only link is the role
name. The owner approved it under a strict rule: an Identity role links to a
PAM role only when the display name is **exactly equal and unique on both
sides** (1 to 1); a name repeated on either side is ambiguous and never counts.

The same approval extends to SIA (2026-10-05): SIA policies name their
grantees by user name and by Identity role name. A policy reaches a person
when a ``granted_users`` entry is **exactly** the person's Identity user name
(unique among Identity users) or their PAM user name, or when a
``granted_roles`` entry is **exactly** one of the person's Identity roles whose
name is unique among Identity roles. Ambiguous names never count.

Read-only; it never persists an edge between sources, never feeds
/api/cmdb/coverage or any KPI, and the UI labels it as a name reference, not a
confirmed link. See "Excepciones sancionadas entre fuentes" in
docs/architecture/integration-contracts.md.
"""

from psycopg_pool import AsyncConnectionPool

from app.db import fetch_one

IDENTITY_SOURCE_SYSTEM = "identity_administration"
PAM_SOURCE_SYSTEM = "cyberark"
SIA_SOURCE_SYSTEM = "sia"
ROLE_NAME_EXACT = "role_name_exact"
GRANTEE_NAME_EXACT = "grantee_name_exact"

_ROLE_ACCESS_SQL = """
    WITH identity_roles AS (
        SELECT DISTINCT ro.display_name AS name
        FROM public.cyberark_inventory_relationships r
        JOIN public.cyberark_inventory_objects ro
          ON ro.object_id = r.target_object_id AND ro.lifecycle_status = 'active'
         AND ro.source_system = %(identity)s AND ro.object_type = 'role'
        WHERE r.source_object_id = %(user_id)s
          AND r.relationship_type = 'user_has_role' AND r.lifecycle_status = 'active'
    ),
    identity_names AS (
        SELECT display_name AS name, count(*) AS total
        FROM public.cyberark_inventory_objects
        WHERE source_system = %(identity)s AND object_type = 'role' AND lifecycle_status = 'active'
        GROUP BY display_name
    ),
    pam_names AS (
        SELECT display_name AS name, count(*) AS total, min(object_id) AS object_id
        FROM public.cyberark_inventory_objects
        WHERE source_system = %(pam)s AND object_type = 'role' AND lifecycle_status = 'active'
        GROUP BY display_name
    ),
    candidates AS (
        SELECT ir.name, i.total AS identity_total, p.total AS pam_total, p.object_id AS pam_role_id
        FROM identity_roles ir
        JOIN identity_names i USING (name)
        JOIN pam_names p USING (name)
    ),
    linked AS (
        SELECT pam_role_id FROM candidates WHERE identity_total = 1 AND pam_total = 1
    )
    SELECT
        (SELECT count(*) FROM linked)::int AS matched_roles,
        (SELECT count(*) FROM candidates WHERE identity_total > 1 OR pam_total > 1)::int AS ambiguous_roles,
        (SELECT count(DISTINCT g.target_object_id)
           FROM linked l
           JOIN public.cyberark_inventory_relationships g
             ON g.source_object_id = l.pam_role_id
            AND g.relationship_type = 'role_grants_access' AND g.lifecycle_status = 'active'
           JOIN public.cyberark_inventory_objects s
             ON s.object_id = g.target_object_id AND s.lifecycle_status = 'active')::int AS safes
"""


async def pam_access_through_identity_roles(pool: AsyncConnectionPool, identity_user_object_id: int) -> dict:
    """Roles linked by exact unique name, ambiguous names, and the Safes they reach."""
    row = await fetch_one(pool, _ROLE_ACCESS_SQL, {
        "identity": IDENTITY_SOURCE_SYSTEM, "pam": PAM_SOURCE_SYSTEM, "user_id": identity_user_object_id,
    })
    return {
        "basis": ROLE_NAME_EXACT,
        "matched_roles": row["matched_roles"] if row else 0,
        "ambiguous_roles": row["ambiguous_roles"] if row else 0,
        "safes": row["safes"] if row else 0,
    }


_SIA_ACCESS_SQL = """
    WITH policies AS (
        SELECT object_id, attributes
        FROM public.cyberark_inventory_objects
        WHERE source_system = %(sia)s AND object_type = 'access_policy' AND lifecycle_status = 'active'
    ),
    identity_user AS (
        SELECT attributes->>'user_name' AS name
        FROM public.cyberark_inventory_objects
        WHERE object_id = %(user_id)s AND source_system = %(identity)s
          AND object_type = 'user' AND lifecycle_status = 'active'
    ),
    identity_user_names AS (
        SELECT attributes->>'user_name' AS name, count(*) AS total
        FROM public.cyberark_inventory_objects
        WHERE source_system = %(identity)s AND object_type = 'user' AND lifecycle_status = 'active'
        GROUP BY attributes->>'user_name'
    ),
    user_names AS (
        SELECT iu.name FROM identity_user iu JOIN identity_user_names n USING (name) WHERE n.total = 1
        UNION
        SELECT name FROM unnest(%(pam_names)s::text[]) AS name
    ),
    by_user AS (
        SELECT DISTINCT p.object_id
        FROM policies p JOIN user_names u ON p.attributes->'granted_users' ? u.name
    ),
    identity_roles AS (
        SELECT DISTINCT ro.display_name AS name
        FROM public.cyberark_inventory_relationships r
        JOIN public.cyberark_inventory_objects ro
          ON ro.object_id = r.target_object_id AND ro.lifecycle_status = 'active'
         AND ro.source_system = %(identity)s AND ro.object_type = 'role'
        WHERE r.source_object_id = %(user_id)s
          AND r.relationship_type = 'user_has_role' AND r.lifecycle_status = 'active'
    ),
    identity_names AS (
        SELECT display_name AS name, count(*) AS total
        FROM public.cyberark_inventory_objects
        WHERE source_system = %(identity)s AND object_type = 'role' AND lifecycle_status = 'active'
        GROUP BY display_name
    ),
    granted_role_names AS (
        SELECT DISTINCT g.name
        FROM policies p, jsonb_array_elements_text(p.attributes->'granted_roles') AS g(name)
    ),
    role_candidates AS (
        SELECT ir.name, i.total AS identity_total
        FROM identity_roles ir
        JOIN identity_names i USING (name)
        JOIN granted_role_names USING (name)
    ),
    linked_roles AS (
        SELECT name FROM role_candidates WHERE identity_total = 1
    ),
    by_role AS (
        SELECT DISTINCT p.object_id
        FROM policies p JOIN linked_roles l ON p.attributes->'granted_roles' ? l.name
    )
    SELECT
        (SELECT count(*) FROM by_user)::int AS user_policies,
        (SELECT count(*) FROM by_role)::int AS role_policies,
        (SELECT count(*) FROM (SELECT object_id FROM by_user UNION SELECT object_id FROM by_role) AS reached)::int AS policies,
        (SELECT count(*) FROM linked_roles)::int AS matched_roles,
        (SELECT count(*) FROM role_candidates WHERE identity_total > 1)::int AS ambiguous_roles
"""


async def sia_access_for_person(
    pool: AsyncConnectionPool,
    *,
    identity_user_object_id: int | None,
    pam_user_name: str | None,
) -> dict:
    """SIA policies reaching a person directly (user name) or through an Identity role."""
    row = await fetch_one(pool, _SIA_ACCESS_SQL, {
        "sia": SIA_SOURCE_SYSTEM, "identity": IDENTITY_SOURCE_SYSTEM,
        "user_id": identity_user_object_id, "pam_names": [pam_user_name] if pam_user_name else [],
    })
    keys = ("user_policies", "role_policies", "policies", "matched_roles", "ambiguous_roles")
    return {"basis": GRANTEE_NAME_EXACT, **{key: (row[key] if row else 0) for key in keys}}
