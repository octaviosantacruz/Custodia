"""Execute the Relaciones Identity <-> PAM link SQL on opt-in test Postgres."""

from uuid import uuid4

from psycopg.types.json import Jsonb

from app.cross.repositories.identity_pam_bridge import (
    identity_links_for_pam_users,
    resolve_identity_pam_user,
)
from app.cyberark.pam.repositories.pam_chain_expand import expand_chain_node, get_chain_node, search_chain_nodes
from tests.support.pg_integration_base import PostgresIntegrationTestCase


class IdentityPamLinksPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.tag = uuid4().hex[:10]
        self.source_ids: list[str] = []
        self.addAsyncCleanup(self._cleanup)

    async def _cleanup(self):
        async with self.pool.connection() as conn:
            await conn.execute(
                "DELETE FROM public.cyberark_inventory_objects WHERE source_id = ANY(%s)",
                (self.source_ids,),
            )

    async def _insert(self, source_system, source_id, display_name, attributes) -> int:
        self.source_ids.append(source_id)
        async with self.pool.connection() as conn:
            cursor = await conn.execute(
                """INSERT INTO public.cyberark_inventory_objects
                   (source_system, object_type, source_id, display_name, lifecycle_status, attributes)
                   VALUES (%s, 'user', %s, %s, 'active', %s) RETURNING object_id""",
                (source_system, source_id, display_name, Jsonb(attributes)),
            )
            return (await cursor.fetchone())["object_id"]

    def _email(self, name: str) -> str:
        return f"{name}-{self.tag}@example.test"

    async def _pam(self, name: str, *, user_type="EPVUser", source_id=None) -> int:
        email = self._email(name)
        return await self._insert("cyberark", source_id or email, email, {"user_type": user_type})

    async def _identity(self, name: str, *, source_id=None, email=None) -> int:
        return await self._insert(
            "identity_administration", source_id or f"uuid-{self.tag}-{name}", f"Person {name}",
            {"email": email or self._email(name)},
        )

    async def _links(self, *pam_ids: int) -> dict[int, tuple[str, str]]:
        rows = await identity_links_for_pam_users(self.pool, list(pam_ids))
        return {row["pam_object_id"]: (row["basis"], row["display_name"]) for row in rows}

    async def test_exact_email_one_to_one_links_a_human_pam_user(self):
        pam = await self._pam("ada")
        await self._identity("ada", email=self._email("ada").upper())
        self.assertEqual(await self._links(pam), {pam: ("email_exact", "Person ada")})

    async def test_shared_source_id_links_by_uuid_even_with_a_different_email(self):
        pam = await self._insert("cyberark", f"shared-{self.tag}", "svc", {"user_type": "EPVUser"})
        await self._identity("bob", source_id=f"shared-{self.tag}", email=self._email("other"))
        self.assertEqual(await self._links(pam), {pam: ("uuid_exact", "Person bob")})

    async def test_ambiguous_or_ineligible_matches_never_draw_a_link(self):
        duplicated = await self._pam("dup")
        await self._identity("dup-1", email=self._email("dup"))
        await self._identity("dup-2", email=self._email("dup"))
        component = await self._pam("comp", user_type="CPMUser")
        await self._identity("comp")
        unmatched = await self._pam("nobody")
        self.assertEqual(await self._links(duplicated, component, unmatched), {})

    async def test_reverse_links_agree_with_the_forward_resolution(self):
        pam = await self._pam("eve")
        identity = await self._identity("eve")
        forward = await resolve_identity_pam_user(
            self.pool, f"uuid-{self.tag}-eve", self._email("eve"),
        )
        self.assertEqual((forward["status"], forward["pam_user"]["object_id"]), ("matched", pam))
        rows = await identity_links_for_pam_users(self.pool, [pam])
        self.assertEqual([row["identity_object_id"] for row in rows], [identity])

    async def test_search_finds_the_pam_user_through_the_person_but_not_by_uuid(self):
        pam = await self._pam("frank")
        await self._identity("frank")
        unlinked = await self._identity("nolink")
        del unlinked
        for query, expected in ((f"frank-{self.tag}", [pam]), ("Person frank", [pam]), (f"uuid-{self.tag}-frank", [])):
            result = await search_chain_nodes(
                self.pool, query=query, node_types=("user",), include_identity=True,
            )
            ids = [row["id"] for row in result["groups"]["user"]]
            self.assertEqual([i for i in ids if i == pam], expected, query)
        # The person's name only reaches the PAM user with the Identity permission.
        result = await search_chain_nodes(self.pool, query="Person frank", node_types=("user",))
        self.assertEqual(result["groups"]["user"], [])
        # Non-matching people never appear as nodes: only PAM accounts are nodes.
        person = await search_chain_nodes(
            self.pool, query="Person nolink", node_types=("user",), include_identity=True,
        )
        self.assertEqual(person["groups"]["user"], [])

    async def test_the_person_travels_inside_the_pam_user_node_and_its_hops(self):
        pam = await self._pam("gina")
        await self._identity("gina")
        node = await get_chain_node(self.pool, node_type="user", node_id=pam, include_identity=True)
        self.assertEqual((node["id"], node["identity"]["display_name"], node["identity"]["basis"]),
                         (pam, "Person gina", "email_exact"))
        self.assertNotIn("identity", await get_chain_node(self.pool, node_type="user", node_id=pam))
        async with self.pool.connection() as conn:
            cursor = await conn.execute(
                """INSERT INTO public.cyberark_inventory_objects
                   (source_system, object_type, source_id, display_name, lifecycle_status, attributes)
                   VALUES ('cyberark', 'role', %s, %s, 'active', '{}') RETURNING object_id""",
                (f"role-{self.tag}", f"Role {self.tag}"),
            )
            role = (await cursor.fetchone())["object_id"]
            await conn.execute(
                """INSERT INTO public.cyberark_inventory_relationships
                   (source_object_id, target_object_id, relationship_type, lifecycle_status)
                   VALUES (%s, %s, 'user_has_role', 'active')""",
                (pam, role),
            )
        self.addAsyncCleanup(self._drop_role, role)
        back = await expand_chain_node(
            self.pool, node_type="role", node_id=role, direction="back", include_identity=True,
        )
        (hop,) = back["rows"]
        self.assertEqual((hop["id"], hop["identity"]["display_name"]), (pam, "Person gina"))

    async def _drop_role(self, role: int):
        async with self.pool.connection() as conn:
            await conn.execute("DELETE FROM public.cyberark_inventory_relationships WHERE target_object_id = %s", (role,))
            await conn.execute("DELETE FROM public.cyberark_inventory_objects WHERE object_id = %s", (role,))

    async def test_hop_counts_are_real_numbers_not_always_zero(self):
        """A role row shows how many users reach it and how many Safes it opens."""
        pam = await self._pam("hank")
        other = await self._pam("ivy")
        async with self.pool.connection() as conn:
            ids = {}
            for kind, source_id in (("role", f"role-{self.tag}"), ("safe", f"9{int(self.tag, 16) % 10**8}")):
                self.source_ids.append(source_id)
                cursor = await conn.execute(
                    """INSERT INTO public.cyberark_inventory_objects
                       (source_system, object_type, source_id, display_name, lifecycle_status, attributes)
                       VALUES ('cyberark', %s, %s, %s, 'active', '{}') RETURNING object_id""",
                    (kind, source_id, f"{kind}-{self.tag}"),
                )
                ids[kind] = (await cursor.fetchone())["object_id"]
            for source, target, kind in ((pam, ids["role"], "user_has_role"), (other, ids["role"], "user_has_role"),
                                          (ids["role"], ids["safe"], "role_grants_access")):
                await conn.execute(
                    """INSERT INTO public.cyberark_inventory_relationships
                       (source_object_id, target_object_id, relationship_type, lifecycle_status)
                       VALUES (%s, %s, %s, 'active')""", (source, target, kind),
                )
        self.addAsyncCleanup(self._drop_relationships, list(ids.values()))
        result = await expand_chain_node(self.pool, node_type="user", node_id=pam, direction="forward")
        (role,) = result["rows"]
        self.assertEqual((role["back_count"], role["forward_count"]), (2, 1))
        node = await get_chain_node(self.pool, node_type="role", node_id=ids["role"])
        self.assertEqual((node["back_count"], node["forward_count"]), (2, 1))

    async def _drop_relationships(self, object_ids: list[int]):
        async with self.pool.connection() as conn:
            await conn.execute(
                "DELETE FROM public.cyberark_inventory_relationships WHERE source_object_id = ANY(%s) OR target_object_id = ANY(%s)",
                (object_ids, object_ids),
            )
            await conn.execute("DELETE FROM public.cyberark_inventory_objects WHERE object_id = ANY(%s)", (object_ids,))
