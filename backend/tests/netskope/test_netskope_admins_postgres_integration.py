"""NSK-RBAC-001: administrators, roles and the page map on a real PostgreSQL -- types accepted, queries, edges, retirement."""

from uuid import uuid4

from app.cross.cmdb_sync import sync_inventory_snapshot
from app.netskope.sse.repositories.netskope_admins import (
    get_netskope_admin_role, list_netskope_admin_roles, list_netskope_admins,
)
from app.netskope.sse.services.netskope_rbac_mapping import (
    ADMIN_EXTENSION, ADMIN_OBJECT_TYPE, ADMIN_ROLE_RELATIONSHIP, API_GROUP_OBJECT_TYPE, ROLE_OBJECT_TYPE,
    map_admin_roles, map_admins, map_api_groups,
)
from tests.support.pg_integration_base import PostgresIntegrationTestCase

PREFIX = "9100"  # role ids and group ids are numeric; the admin ids carry the text prefix below
ADMIN_PREFIX = "rbac-test-"
ROLES = [{"roleId": 910001, "name": "Tenant Admin", "type": 0, "userCount": 2},
         {"roleId": 910002, "name": "Reader", "type": 1, "userCount": 0},
         {"roleId": -910003, "name": "Predefined analyst", "type": 1, "userCount": 1}]
DETAILS = {
    910001: {"roleId": 910001, "apiGroups": [
        {"apiGroupId": 910101, "apiGroupName": "admins", "permission": "rwa"},
        {"apiGroupId": 910102, "apiGroupName": "devices", "permission": "r"},
        {"apiGroupId": 910103, "apiGroupName": "hidden", "permission": "none"},
    ]},
    910002: {"roleId": 910002, "apiGroups": [{"apiGroupId": 910102, "apiGroupName": "devices", "permission": "r"}]},
    -910003: {"roleId": -910003, "apiGroups": [{"apiGroupId": 910102, "apiGroupName": "devices", "permission": "rw"}]},
}
PAGES = [
    {"v3_api_group_id": 910101, "v3_api_group_name": "admins", "v2_page_name": "Administrators", "v2_parent_page_name": "Settings"},
    {"v3_api_group_id": 910102, "v3_api_group_name": "devices", "v2_page_name": "Devices", "v2_parent_page_name": "Manage"},
    {"v3_api_group_id": 910102, "v3_api_group_name": "devices", "v2_page_name": "Clients", "v2_parent_page_name": "Manage"},
]


def admin(name, *, role=None, active=True, kind="USER", mfa=False):
    extension = {"recordType": kind, "mfa": {"enabled": mfa}}
    if role is not None:
        extension["role"] = {"value": role, "display": "x"}
    return {"id": ADMIN_PREFIX + name, "userName": f"{name}@example.test", "active": active, ADMIN_EXTENSION: extension}


ADMINS = [admin("alice", role=910001, mfa=True), admin("bob", role=910001, active=False),
          admin("carol"), admin("svc", role=910002, kind="SERVICE_ACCOUNT"), admin("erin", role=-910003, mfa=True)]
TYPES = frozenset({ROLE_OBJECT_TYPE, ADMIN_OBJECT_TYPE, API_GROUP_OBJECT_TYPE})


class NetskopeAdminsPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.addAsyncCleanup(self.cleanup)
        await self.cleanup()

    async def cleanup(self):
        async with self.pool.connection() as conn:
            await conn.execute("""
                DELETE FROM public.cyberark_inventory_relationships WHERE relationship_type = 'has_role'
                  AND source_object_id IN (SELECT object_id FROM public.cyberark_inventory_objects WHERE source_id LIKE %s)
            """, (ADMIN_PREFIX + "%",))
            await conn.execute("DELETE FROM public.cyberark_inventory_objects WHERE source_id LIKE %s OR source_id LIKE %s OR source_id LIKE %s",
                               (ADMIN_PREFIX + "%", PREFIX + "%", "-" + PREFIX + "%"))
            await conn.commit()

    async def snapshot(self, admins=ADMINS, roles=ROLES, *, reconcile=True):
        role_objects = map_admin_roles(roles, DETAILS)
        admin_objects, relationships, _ = map_admins(admins, {o.source_id for o in role_objects})
        await sync_inventory_snapshot(
            self.pool, role_objects + admin_objects + map_api_groups(PAGES), relationships, source_run_id=str(uuid4()),
            source_system="netskope", reconcile_object_types=TYPES if reconcile else frozenset(),
            reconcile_relationship_types=frozenset({ADMIN_ROLE_RELATIONSHIP} if reconcile else set()),
        )

    async def admins(self, **filters):
        args = dict(search="", record_type="", state="", role="", limit=100, offset=0) | filters
        result = await list_netskope_admins(self.pool, **args)
        return result, [row for row in result["rows"] if row["id"].startswith(ADMIN_PREFIX)]

    async def test_the_database_accepts_the_types_and_lists_admins_with_their_role(self):
        await self.snapshot()
        _, rows = await self.admins()
        by_name = {row["name"]: row for row in rows}
        self.assertEqual(set(by_name), {f"{n}@example.test" for n in ("alice", "bob", "carol", "svc", "erin")})
        self.assertEqual((by_name["alice@example.test"]["role_name"], by_name["alice@example.test"]["mfa_enabled"]), ("Tenant Admin", True))
        self.assertIsNone(by_name["carol@example.test"]["role_id"])
        self.assertEqual(set(rows[0]), {"id", "name", "active", "is_locked", "record_type", "last_login", "mfa_enabled", "role_id", "role_name"})

    async def test_filters_by_state_kind_role_and_name(self):
        await self.snapshot()
        names = lambda rows: {row["name"].split("@")[0] for row in rows}
        self.assertEqual(names((await self.admins(state="inactive"))[1]), {"bob"})
        self.assertEqual(names((await self.admins(record_type="SERVICE_ACCOUNT"))[1]), {"svc"})
        self.assertEqual(names((await self.admins(role="none"))[1]), {"carol"})
        self.assertEqual(names((await self.admins(role="910001"))[1]), {"alice", "bob"})
        self.assertEqual(names((await self.admins(search="CAROL"))[1]), {"carol"})

    async def test_the_summary_counts_what_needs_attention(self):
        await self.snapshot()
        summary, _ = await self.admins()
        # The test database holds only these rows.
        self.assertEqual(
            {key: summary[key] for key in ("total", "active", "active_without_role", "service_accounts", "active_people_without_mfa")},
            {"total": 5, "active": 4, "active_without_role": 1, "service_accounts": 1, "active_people_without_mfa": 1},
        )  # carol is active, without role and without MFA; bob is inactive

    async def test_roles_list_with_observed_admins_and_permission_levels(self):
        await self.snapshot()
        roles = {row["name"]: row for row in (await list_netskope_admin_roles(self.pool))["rows"] if row["id"].startswith(PREFIX)}
        admin_role = roles["Tenant Admin"]
        self.assertEqual((admin_role["admins"], admin_role["admin_groups"], admin_role["read_groups"], admin_role["write_groups"]), (2, 1, 1, 0))
        self.assertEqual(admin_role["api_groups_total"], 3)  # the `none` group counts in the total, not in a level
        self.assertEqual(roles["Reader"]["admins"], 1)

    async def test_a_predefined_role_with_a_negative_id_links_filters_and_opens_like_any_other(self):
        await self.snapshot()
        _, rows = await self.admins(role="-910003")
        self.assertEqual([row["name"] for row in rows], ["erin@example.test"])
        self.assertEqual(rows[0]["role_name"], "Predefined analyst")
        detail = await get_netskope_admin_role(self.pool, "-910003")
        self.assertEqual([(p["group"], p["permission"]) for p in detail["permissions"]], [("devices", "rw")])
        self.assertEqual({a["name"] for a in detail["admins"]}, {"erin@example.test"})

    async def test_role_detail_maps_permissions_to_console_pages_and_lists_its_admins(self):
        await self.snapshot()
        detail = await get_netskope_admin_role(self.pool, "910001")
        self.assertEqual([(p["group"], p["permission"]) for p in detail["permissions"]], [("admins", "rwa"), ("devices", "r")])
        self.assertEqual(detail["permissions"][1]["pages"], ["Clients", "Devices"])
        self.assertEqual({a["name"].split("@")[0] for a in detail["admins"]}, {"alice", "bob"})
        self.assertIsNone(await get_netskope_admin_role(self.pool, "910999"))

    async def test_a_complete_read_retires_an_absent_admin_but_a_failed_one_retires_nothing(self):
        await self.snapshot()
        await self.snapshot(ADMINS[:1], reconcile=False)
        self.assertEqual(len((await self.admins())[1]), 5)
        await self.snapshot(ADMINS[:1])
        self.assertEqual({row["name"].split("@")[0] for row in (await self.admins())[1]}, {"alice"})
        detail = await get_netskope_admin_role(self.pool, "910001")
        self.assertEqual({a["name"].split("@")[0] for a in detail["admins"]}, {"alice"})  # bob's edge is retired too
