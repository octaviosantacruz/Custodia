"""Sanctioned exception (2026-10-05): PAM access through Identity roles linked by
exact, unique role name, executed on a real PostgreSQL."""

from uuid import uuid4

from app.cross.cmdb_sync import sync_inventory_snapshot
from app.cross.repositories.person_role_access import pam_access_through_identity_roles, sia_access_for_person
from app.cross.services.cmdb_models import InventoryObject, InventoryRelationship
from tests.support.pg_integration_base import PostgresIntegrationTestCase

PREFIX = "role-access-test-"


def obj(kind, key, name, system, **attributes):
    return InventoryObject(kind, PREFIX + key, name, system, attributes=attributes)


def rel(source_type, source, target_type, target, kind, system):
    return InventoryRelationship(source_type, PREFIX + source, target_type, PREFIX + target, kind, system)


class PersonRoleAccessPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.addAsyncCleanup(self.cleanup)
        await self.cleanup()

    async def cleanup(self):
        async with self.pool.connection() as conn:
            await conn.execute("""
                DELETE FROM public.cyberark_inventory_relationships WHERE source_object_id IN (
                    SELECT object_id FROM public.cyberark_inventory_objects WHERE source_id LIKE %s)
            """, (PREFIX + "%",))
            await conn.execute("DELETE FROM public.cyberark_inventory_objects WHERE source_id LIKE %s", (PREFIX + "%",))
            await conn.commit()

    async def seed(self):
        identity = [
            obj("user", "ana", "Ana", "identity_administration"),
            obj("role", "i-ops", "Ops Admins", "identity_administration"),
            obj("role", "i-dup", "Shared Name", "identity_administration"),
            obj("role", "i-none", "Only In Identity", "identity_administration"),
            obj("role", "i-idup-1", "Twice In Identity", "identity_administration"),
            obj("role", "i-idup-2", "Twice In Identity", "identity_administration"),
        ]
        identity_rels = [
            rel("user", "ana", "role", "i-ops", "user_has_role", "identity_administration"),
            rel("user", "ana", "role", "i-dup", "user_has_role", "identity_administration"),
            rel("user", "ana", "role", "i-none", "user_has_role", "identity_administration"),
            rel("user", "ana", "role", "i-idup-1", "user_has_role", "identity_administration"),
        ]
        pam = [
            obj("role", "p-ops", "Ops Admins", "cyberark"),
            obj("role", "p-dup-1", "Shared Name", "cyberark"),
            obj("role", "p-dup-2", "Shared Name", "cyberark"),
            obj("role", "p-idup", "Twice In Identity", "cyberark"),
            obj("safe", "s1", "Safe 1", "cyberark"),
            obj("safe", "s2", "Safe 2", "cyberark"),
            obj("safe", "s3", "Safe 3", "cyberark"),
        ]
        pam_rels = [
            rel("role", "p-ops", "safe", "s1", "role_grants_access", "cyberark"),
            rel("role", "p-ops", "safe", "s2", "role_grants_access", "cyberark"),
            rel("role", "p-dup-1", "safe", "s3", "role_grants_access", "cyberark"),
            rel("role", "p-idup", "safe", "s3", "role_grants_access", "cyberark"),
        ]
        for objects, relationships, system in ((identity, identity_rels, "identity_administration"), (pam, pam_rels, "cyberark")):
            await sync_inventory_snapshot(
                self.pool, objects, relationships, source_run_id=str(uuid4()), source_system=system,
                reconcile_object_types=frozenset(), reconcile_relationship_types=frozenset(),
            )
        async with self.pool.connection() as conn:
            cursor = await conn.execute("SELECT object_id FROM public.cyberark_inventory_objects WHERE source_id = %s", (PREFIX + "ana",))
            return (await cursor.fetchone())["object_id"]

    async def test_only_exact_unique_names_on_both_sides_reach_safes(self):
        ana = await self.seed()
        result = await pam_access_through_identity_roles(self.pool, ana)
        # "Ops Admins" links 1 to 1 and reaches s1 and s2. "Shared Name" repeats in
        # PAM and "Twice In Identity" repeats in Identity: both are ambiguous and
        # their Safe (s3) never counts. "Only In Identity" has no PAM role at all.
        self.assertEqual(result, {"basis": "role_name_exact", "matched_roles": 1, "ambiguous_roles": 2, "safes": 2})

    async def test_a_person_without_roles_reaches_nothing(self):
        await self.seed()
        await sync_inventory_snapshot(
            self.pool, [obj("user", "bea", "Bea", "identity_administration")], [], source_run_id=str(uuid4()),
            source_system="identity_administration", reconcile_object_types=frozenset(),
        )
        async with self.pool.connection() as conn:
            bea = (await (await conn.execute("SELECT object_id FROM public.cyberark_inventory_objects WHERE source_id = %s", (PREFIX + "bea",))).fetchone())["object_id"]
        self.assertEqual(await pam_access_through_identity_roles(self.pool, bea), {"basis": "role_name_exact", "matched_roles": 0, "ambiguous_roles": 0, "safes": 0})


    async def seed_sia(self):
        """Ana (Identity user ``ana@corp``) holds "Ops Admins" (unique) and "Twice In Identity" (repeated)."""
        ana = await self.seed()
        async with self.pool.connection() as conn:
            await conn.execute(
                "UPDATE public.cyberark_inventory_objects SET attributes = %s::jsonb WHERE source_id = %s",
                ('{"user_name": "ana@corp"}', PREFIX + "ana"),
            )
            await conn.commit()
        policy = lambda key, users=(), roles=(): obj(  # noqa: E731
            "access_policy", key, key, "sia", granted_users=list(users), granted_roles=list(roles), granted_groups=[],
        )
        policies = [
            policy("pol-user", users=["ana@corp"]),
            policy("pol-pam-name", users=["ana.pam"]),
            policy("pol-role", roles=["Ops Admins"]),
            policy("pol-both", users=["ana@corp"], roles=["Ops Admins"]),
            policy("pol-ambiguous-role", roles=["Twice In Identity"]),
            policy("pol-near-miss", users=["ANA@corp", "ana@corp "], roles=["ops admins"]),
        ]
        await sync_inventory_snapshot(
            self.pool, policies, [], source_run_id=str(uuid4()), source_system="sia",
            reconcile_object_types=frozenset(), reconcile_relationship_types=frozenset(),
        )
        return ana

    async def test_sia_policies_reach_a_person_only_by_exact_user_or_unique_identity_role_name(self):
        ana = await self.seed_sia()
        result = await sia_access_for_person(self.pool, identity_user_object_id=ana, pam_user_name=None)
        # pol-user and pol-both by user name; pol-role and pol-both by "Ops Admins".
        # The repeated Identity role and case/space near-misses never count.
        self.assertEqual(result, {
            "basis": "grantee_name_exact", "user_policies": 2, "role_policies": 2, "policies": 3,
            "matched_roles": 1, "ambiguous_roles": 1,
        })

    async def test_sia_adds_the_pam_user_name_and_works_without_identity(self):
        ana = await self.seed_sia()
        both = await sia_access_for_person(self.pool, identity_user_object_id=ana, pam_user_name="ana.pam")
        self.assertEqual((both["user_policies"], both["policies"]), (3, 4))
        pam_only = await sia_access_for_person(self.pool, identity_user_object_id=None, pam_user_name="ana.pam")
        self.assertEqual((pam_only["user_policies"], pam_only["role_policies"], pam_only["policies"]), (1, 0, 1))
