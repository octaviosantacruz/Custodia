"""Read-only reconciliation of Privilege Cloud Standard seat evidence."""

import asyncio

from psycopg_pool import AsyncConnectionPool

from ..db import fetch_all, fetch_one

PAM_SOURCE = "cyberark"
STANDARD_USER_TYPE = "EPVUser"
LICENSE_ROLE_NAMES = ("Privilege Cloud Administrators", "Privilege Cloud Users")
OKTA_GROUP_PREFIX = "sg_cyberark_privilege_cloud_"


async def get_standard_seat_reconciliation(pool: AsyncConnectionPool):
    """Return the verified Standard-seat population and its role evidence.

    This is a reconciliation, not an entitlement or billing API.  A user is
    confirmed only when an active PAM ``EPVUser`` belongs to one of the two
    tenant-approved Privilege Cloud roles.
    """
    rows, totals = await asyncio.gather(
        fetch_all(pool, """
            WITH license_roles AS (
              SELECT object_id, display_name
              FROM public.cyberark_inventory_objects
              WHERE source_system = %s AND object_type = 'role'
                AND lifecycle_status = 'active' AND display_name = ANY(%s)
            ), seat_members AS (
              SELECT u.object_id, u.display_name, u.source_id,
                     u.attributes->>'user_id' AS user_id,
                     lr.display_name AS license_role
              FROM public.cyberark_inventory_relationships membership
              JOIN license_roles lr ON lr.object_id = membership.target_object_id
              JOIN public.cyberark_inventory_objects u ON u.object_id = membership.source_object_id
              WHERE membership.relationship_type = 'user_has_role'
                AND membership.lifecycle_status = 'active'
                AND u.source_system = %s AND u.object_type = 'user'
                AND u.lifecycle_status = 'active'
                AND u.attributes->>'user_type' = %s
            ), okta_groups AS (
              SELECT membership.source_object_id AS user_object_id,
                     array_agg(DISTINCT role.display_name ORDER BY role.display_name) AS groups
              FROM public.cyberark_inventory_relationships membership
              JOIN public.cyberark_inventory_objects role ON role.object_id = membership.target_object_id
              WHERE membership.relationship_type = 'user_has_role'
                AND membership.lifecycle_status = 'active'
                AND role.source_system = %s AND role.object_type = 'role'
                AND role.lifecycle_status = 'active'
                AND role.display_name ILIKE %s
              GROUP BY membership.source_object_id
            )
            SELECT sm.object_id, sm.display_name, sm.source_id, sm.user_id,
                   array_agg(DISTINCT sm.license_role ORDER BY sm.license_role) AS license_roles,
                   coalesce(og.groups, '{}'::text[]) AS okta_groups
            FROM seat_members sm
            LEFT JOIN okta_groups og ON og.user_object_id = sm.object_id
            GROUP BY sm.object_id, sm.display_name, sm.source_id, sm.user_id, og.groups
            ORDER BY lower(sm.display_name), sm.object_id
        """, (PAM_SOURCE, list(LICENSE_ROLE_NAMES), PAM_SOURCE, STANDARD_USER_TYPE, PAM_SOURCE, f"{OKTA_GROUP_PREFIX}%")),
        fetch_one(pool, """
            WITH role_members AS (
              SELECT DISTINCT membership.source_object_id
              FROM public.cyberark_inventory_relationships membership
              JOIN public.cyberark_inventory_objects role ON role.object_id = membership.target_object_id
              WHERE membership.relationship_type = 'user_has_role'
                AND membership.lifecycle_status = 'active'
                AND role.source_system = %s AND role.object_type = 'role'
                AND role.lifecycle_status = 'active' AND role.display_name = ANY(%s)
            ), standard_users AS (
              SELECT object_id
              FROM public.cyberark_inventory_objects
              WHERE source_system = %s AND object_type = 'user'
                AND lifecycle_status = 'active' AND attributes->>'user_type' = %s
            )
            SELECT
              (SELECT count(*)::int FROM standard_users) AS standard_users,
              (SELECT count(*)::int FROM role_members rm JOIN standard_users su ON su.object_id = rm.source_object_id) AS reconciled_users,
              (SELECT count(*)::int FROM standard_users su WHERE NOT EXISTS (SELECT 1 FROM role_members rm WHERE rm.source_object_id = su.object_id)) AS only_user_type,
              (SELECT count(*)::int FROM role_members rm WHERE NOT EXISTS (SELECT 1 FROM standard_users su WHERE su.object_id = rm.source_object_id)) AS only_role_members
        """, (PAM_SOURCE, list(LICENSE_ROLE_NAMES), PAM_SOURCE, STANDARD_USER_TYPE)),
    )
    totals = totals or {"standard_users": 0, "reconciled_users": 0, "only_user_type": 0, "only_role_members": 0}
    totals["confirmed"] = (
        totals["standard_users"] == totals["reconciled_users"]
        and not totals["only_user_type"]
        and not totals["only_role_members"]
    )
    serialized = []
    for row in rows:
        serialized.append({
            "object_id": row["object_id"],
            "display_name": row["display_name"],
            "source_id": row["source_id"],
            "user_id": row.get("user_id"),
            "license_roles": list(row.get("license_roles") or []),
            "okta_groups": list(row.get("okta_groups") or []),
        })
    return {"totals": totals, "rows": serialized}
