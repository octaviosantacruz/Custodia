"""Regression tests for the Cadenas PAM expansion engine (CHAIN-001/002)."""

import asyncio
import unittest
from contextlib import ExitStack
from unittest.mock import AsyncMock, patch

import httpx

from app.cyberark.pam.repositories.pam_chain_expand import (
    NODE_HOPS,
    SEARCH_TYPES,
    _annotate_identity,
    expand_chain_node,
    get_chain_node,
    search_chain_nodes,
)
from tests.cross.test_permission_http_matrix import _AuthenticatedSession, app


def _run_expand(**kwargs):
    with patch("app.cyberark.pam.repositories.pam_chain_expand.fetch_all", new=AsyncMock(return_value=[])) as fetch:
        result = asyncio.run(expand_chain_node(object(), **kwargs))
    return result, fetch


class ChainHopAllowlistTests(unittest.TestCase):
    def test_allowlist_matches_the_approved_edges(self):
        expected = {
            "user": {"forward": {("role", "user_has_role")}, "back": set()},
            "role": {
                "forward": {("safe", "role_grants_access")},
                "back": {("user", "user_has_role")},
            },
            "safe": {
                "forward": {("platform", "safe_uses_platform")},
                "back": {("role", "role_grants_access")},
            },
            "platform": {
                "forward": {("psm", "platform_uses_psm"), ("access_asset", None)},
                "back": {("safe", "safe_uses_platform")},
            },
            "psm": {"forward": set(), "back": {("platform", "platform_uses_psm")}},
            "access_asset": {"forward": set(), "back": {("platform", None)}},
        }
        for node_type, directions in expected.items():
            for direction, edges in directions.items():
                with self.subTest(node_type=node_type, direction=direction):
                    actual = {
                        (spec.neighbor_type, spec.relationship_type)
                        for spec in NODE_HOPS[node_type][direction]
                    }
                    self.assertEqual(actual, edges)

    def test_derived_hops_are_marked_as_derived_with_platform_id_basis(self):
        platform_forward = {spec.neighbor_type: spec for spec in NODE_HOPS["platform"]["forward"]}
        asset = platform_forward["access_asset"]
        self.assertEqual(asset.relation_kind, "derived")
        self.assertEqual(asset.basis, "platform_id")
        asset_back = NODE_HOPS["access_asset"]["back"][0]
        self.assertEqual(asset_back.relation_kind, "derived")
        self.assertEqual(asset_back.basis, "platform_id")


class ChainExpandSqlTests(unittest.TestCase):
    def test_user_forward_uses_only_user_has_role(self):
        _, fetch = _run_expand(node_type="user", node_id=8, direction="forward")
        sql, params = fetch.await_args.args[1], fetch.await_args.args[2]
        self.assertIn("r.relationship_type = %s", sql)
        self.assertIn("'user_has_role'", sql.replace("r.relationship_type = %s", "'user_has_role'"))
        self.assertIn("r.source_object_id = %s", sql)
        self.assertIn("n.object_type = %s", sql)
        self.assertEqual(params[0], "role")
        self.assertEqual(params[1], 8)
        self.assertEqual(params[2], "user_has_role")

    def test_role_back_returns_users(self):
        _, fetch = _run_expand(node_type="role", node_id=7, direction="back")
        sql, params = fetch.await_args.args[1], fetch.await_args.args[2]
        self.assertIn("r.target_object_id = %s", sql)
        self.assertEqual(params[0], "user")
        self.assertEqual(params[2], "user_has_role")

    def test_platform_forward_unions_psm_and_derived_access_assets(self):
        _, fetch = _run_expand(node_type="platform", node_id=4, direction="forward")
        sql, params = fetch.await_args.args[1], fetch.await_args.args[2]
        self.assertIn("platform_uses_psm", sql)
        self.assertIn("a.attributes->>'platform_id' = anchor.source_id", sql)
        self.assertIn("'access_asset'", sql)
        self.assertEqual(params, ("psm", 4, "platform_uses_psm", 4, 50, 0))

    def test_psm_back_returns_platforms(self):
        _, fetch = _run_expand(node_type="psm", node_id=5, direction="back")
        sql, params = fetch.await_args.args[1], fetch.await_args.args[2]
        self.assertIn("r.relationship_type = %s", sql)
        self.assertEqual(params[0], "platform")
        self.assertEqual(params[2], "platform_uses_psm")

    def test_access_asset_back_returns_its_platform(self):
        _, fetch = _run_expand(node_type="access_asset", node_id=9, direction="back")
        sql, params = fetch.await_args.args[1], fetch.await_args.args[2]
        self.assertIn("p.source_id = coalesce(anchor.attributes->>'platform_id', '')", sql)
        self.assertEqual(params, (9, 50, 0))

    def test_terminal_direction_returns_empty_without_querying(self):
        result, fetch = _run_expand(node_type="user", node_id=8, direction="back")
        self.assertEqual(result, {"rows": [], "total": 0, "limit": 50, "offset": 0})
        fetch.assert_not_awaited()

    def test_both_endpoints_must_be_active(self):
        _, fetch = _run_expand(node_type="safe", node_id=3, direction="forward")
        sql = fetch.await_args.args[1]
        self.assertIn("r.lifecycle_status = 'active'", sql)
        self.assertIn("n.lifecycle_status = 'active'", sql)

    def test_include_internal_filters_safe_neighbors(self):
        _, fetch = _run_expand(node_type="role", node_id=7, direction="forward", include_internal=False)
        sql = fetch.await_args.args[1]
        self.assertIn("meta_hop.inventory_scope", sql)
        self.assertIn("meta_hop.account_type_classification", sql)

        _, fetch = _run_expand(node_type="role", node_id=7, direction="forward", include_internal=True)
        sql = fetch.await_args.args[1]
        self.assertNotIn("meta_hop.inventory_scope", sql)

    def test_pagination_and_total_come_from_the_window_count(self):
        rows = [
            {"id": 1, "node_type": "role", "label": "A", "sublabel": "1",
             "relation_kind": "persisted", "basis": "user_has_role",
             "forward_count": 0, "back_count": 0, "total_count": 7},
        ]
        with patch("app.cyberark.pam.repositories.pam_chain_expand.fetch_all", new=AsyncMock(return_value=rows)) as fetch:
            result = asyncio.run(expand_chain_node(
                object(), node_type="user", node_id=8, direction="forward", limit=25, offset=50,
            ))

        self.assertEqual(result["total"], 7)
        self.assertEqual(result["limit"], 25)
        self.assertEqual(result["offset"], 50)
        params = fetch.await_args.args[2]
        self.assertEqual(params[-2:], (25, 50))
        self.assertNotIn("total_count", result["rows"][0])

    def test_query_filters_by_label_or_sublabel_before_the_window_count(self):
        _, fetch = _run_expand(node_type="role", node_id=7, direction="forward", query="Fin 50%")
        sql, params = fetch.await_args.args[1], fetch.await_args.args[2]
        self.assertIn("WHERE hops.label ILIKE %s OR hops.sublabel ILIKE %s", sql)
        self.assertEqual(params[-4:-2], ("%Fin 50\\%%", "%Fin 50\\%%"))
        self.assertEqual(params[-2:], (50, 0))

    def test_query_escapes_like_wildcards_and_backslashes(self):
        _, fetch = _run_expand(node_type="role", node_id=7, direction="forward", query="a_b\\c%")
        params = fetch.await_args.args[2]
        self.assertEqual(params[-4:-2], ("%a\\_b\\\\c\\%%", "%a\\_b\\\\c\\%%"))

    def test_without_query_no_like_filter_is_added(self):
        _, fetch = _run_expand(node_type="role", node_id=7, direction="forward")
        self.assertNotIn("ILIKE", fetch.await_args.args[1])

    def test_query_with_no_matches_returns_empty_total(self):
        result, fetch = _run_expand(node_type="role", node_id=7, direction="forward", query="nope")
        self.assertEqual(result, {"rows": [], "total": 0, "limit": 50, "offset": 0})
        self.assertIn("ILIKE", fetch.await_args.args[1])


class ChainSiaTramoTests(unittest.TestCase):
    def test_safe_forward_adds_derived_sia_policies_with_permission(self):
        policies = [{"object_id": 20, "display_name": "Finance access", "source_id": "policy-20"}]
        with patch("app.cyberark.pam.repositories.pam_chain_expand.fetch_one", new=AsyncMock(return_value={"source_id": "42"})), \
             patch("app.cyberark.pam.repositories.pam_chain_expand.fetch_all", new=AsyncMock(return_value=[])), \
             patch("app.cyberark.pam.repositories.pam_chain_expand.policies_linked_to_safe", new=AsyncMock(return_value=policies)):
            result = asyncio.run(expand_chain_node(
                object(), node_type="safe", node_id=9, direction="forward", include_sia=True,
            ))

        self.assertEqual(result["rows"][0]["node_type"], "access_policy")
        self.assertEqual(result["rows"][0]["relation_kind"], "derived")
        self.assertEqual(result["rows"][0]["basis"], "ip_literal")
        self.assertEqual(result["total"], 1)

    def test_sia_tramos_are_not_composed_without_the_permission(self):
        with patch("app.cyberark.pam.repositories.pam_chain_expand.fetch_all", new=AsyncMock(return_value=[])), \
             patch("app.cyberark.pam.repositories.pam_chain_expand.policies_linked_to_safe", new=AsyncMock()) as linked:
            result = asyncio.run(expand_chain_node(
                object(), node_type="safe", node_id=9, direction="forward", include_sia=False,
            ))

        linked.assert_not_awaited()
        self.assertEqual(result["rows"], [])

    def test_user_and_role_reference_sia_policies_by_exact_name(self):
        policies = [{"object_id": 20, "display_name": "Finance access", "source_id": "policy-20"}]
        with patch("app.cyberark.pam.repositories.pam_chain_expand.fetch_one", new=AsyncMock(return_value={"display_name": "Ada"})), \
             patch("app.cyberark.pam.repositories.pam_chain_expand.fetch_all", new=AsyncMock(return_value=[])), \
             patch("app.cyberark.pam.repositories.pam_chain_expand.policies_referencing_grantee", new=AsyncMock(return_value=policies)) as referencing:
            result = asyncio.run(expand_chain_node(
                object(), node_type="user", node_id=8, direction="forward", include_sia=True,
            ))

        self.assertFalse(referencing.await_args.kwargs["include_roles"])
        self.assertEqual(result["rows"][0]["relation_kind"], "reference")
        self.assertEqual(result["rows"][0]["basis"], "display_name_reference_only")

    def test_node_forward_count_includes_sia_tramos(self):
        row = {"id": 9, "node_type": "safe", "label": "Finance", "sublabel": "42", "forward_count": 1, "back_count": 1}
        with patch("app.cyberark.pam.repositories.pam_chain_expand.fetch_one", new=AsyncMock(side_effect=[row, {"source_id": "42"}])), \
             patch("app.cyberark.pam.repositories.pam_chain_expand.policies_linked_to_safe", new=AsyncMock(return_value=[
                 {"object_id": 20, "display_name": "Finance access", "source_id": "policy-20"},
             ])):
            result = asyncio.run(get_chain_node(object(), node_type="safe", node_id=9, include_sia=True))

        self.assertEqual(result["forward_count"], 2)
        self.assertEqual(result["back_count"], 1)

    def test_access_policy_is_terminal(self):
        with patch("app.cyberark.pam.repositories.pam_chain_expand.fetch_all", new=AsyncMock()) as fetch:
            result = asyncio.run(expand_chain_node(
                object(), node_type="access_policy", node_id=20, direction="forward", include_sia=True,
            ))
        self.assertEqual(result["rows"], [])
        fetch.assert_not_awaited()

    def test_query_filters_sia_tramos_with_the_same_literal_substring(self):
        policies = [
            {"object_id": 20, "display_name": "Finance access", "source_id": "policy-20"},
            {"object_id": 21, "display_name": "Treasury access", "source_id": "policy-21"},
        ]
        with patch("app.cyberark.pam.repositories.pam_chain_expand.fetch_one", new=AsyncMock(return_value={"source_id": "42"})), \
             patch("app.cyberark.pam.repositories.pam_chain_expand.fetch_all", new=AsyncMock(return_value=[])), \
             patch("app.cyberark.pam.repositories.pam_chain_expand.policies_linked_to_safe", new=AsyncMock(return_value=policies)):
            result = asyncio.run(expand_chain_node(
                object(), node_type="safe", node_id=9, direction="forward", include_sia=True, query="TREASURY",
            ))

        self.assertEqual([row["label"] for row in result["rows"]], ["Treasury access"])
        self.assertEqual(result["total"], 1)


class ChainNodeTests(unittest.TestCase):
    def test_returns_none_when_the_node_is_missing(self):
        with patch("app.cyberark.pam.repositories.pam_chain_expand.fetch_one", new=AsyncMock(return_value=None)):
            self.assertIsNone(asyncio.run(get_chain_node(object(), node_type="role", node_id=1)))

    def test_counts_are_computed_for_both_directions(self):
        with patch("app.cyberark.pam.repositories.pam_chain_expand.fetch_one", new=AsyncMock(return_value={"id": 1})) as fetch:
            asyncio.run(get_chain_node(object(), node_type="role", node_id=1, include_internal=False))

        sql, params = fetch.await_args.args[1], fetch.await_args.args[2]
        self.assertIn("AS forward_count", sql)
        self.assertIn("AS back_count", sql)
        self.assertIn("meta_count.inventory_scope", sql)
        self.assertEqual(params, (1, "role", "cyberark"))

    def test_node_endpoint_filters_internal_safes_when_requested(self):
        row = {"id": 9, "node_type": "safe", "label": "Finance", "sublabel": "42", "forward_count": 1, "back_count": 1}
        with patch("app.cyberark.pam.repositories.pam_chain_expand.fetch_one", new=AsyncMock(return_value=row)) as fetch:
            asyncio.run(get_chain_node(object(), node_type="safe", node_id=9, include_internal=False))
        self.assertIn("meta_node.inventory_scope", fetch.await_args.args[1])

        with patch("app.cyberark.pam.repositories.pam_chain_expand.fetch_one", new=AsyncMock(return_value=row)) as fetch:
            asyncio.run(get_chain_node(object(), node_type="safe", node_id=9, include_internal=True))
        self.assertNotIn("meta_node.inventory_scope", fetch.await_args.args[1])

    def test_access_assets_resolve_in_the_access_source_system(self):
        with patch("app.cyberark.pam.repositories.pam_chain_expand.fetch_one", new=AsyncMock(return_value={"id": 1})) as fetch:
            asyncio.run(get_chain_node(object(), node_type="access_asset", node_id=1))
        self.assertEqual(fetch.await_args.args[2], (1, "access_asset", "access"))


class ChainSearchTests(unittest.TestCase):
    def _run_search(self, *, query="Finance", node_types=SEARCH_TYPES, include_internal=True, standard_seat="", status=""):
        def fake_fetch(pool, sql, params):
            return [{"id": 1, "node_type": params[1], "label": f"{params[1]}-1", "sublabel": "s"}]

        with patch("app.cyberark.pam.repositories.pam_chain_expand.fetch_all", new=AsyncMock(side_effect=fake_fetch)) as fetch:
            result = asyncio.run(search_chain_nodes(
                object(), query=query, node_types=node_types,
                include_internal=include_internal, standard_seat=standard_seat, status=status,
            ))
        return result, fetch

    def test_groups_every_requested_type_with_a_bounded_limit(self):
        result, fetch = self._run_search()
        self.assertEqual(list(result["groups"]), list(SEARCH_TYPES))
        self.assertEqual(fetch.await_count, len(SEARCH_TYPES))
        for call in fetch.await_args_list:
            params = call.args[2]
            self.assertEqual(params[-1], 20)
            self.assertEqual(params[2], "%Finance%")
            self.assertEqual(params[3], "%Finance%")

    def test_escapes_like_wildcards(self):
        _, fetch = self._run_search(query="100%_off")
        params = fetch.await_args_list[0].args[2]
        self.assertEqual(params[2], "%100\\%\\_off%")

    def test_user_search_reports_standard_seat_and_filters_it(self):
        _, fetch = self._run_search(node_types=("user",), standard_seat="reconciled")
        sql = fetch.await_args.args[1]
        self.assertIn("AS standard_seat_reconciled", sql)
        self.assertIn("Privilege Cloud Administrators", sql)
        self.assertIn(" AND (", sql)

        _, fetch = self._run_search(node_types=("user",), standard_seat="unreconciled")
        self.assertIn("AND NOT (", fetch.await_args.args[1])

        _, fetch = self._run_search(node_types=("role",), standard_seat="reconciled")
        sql = fetch.await_args.args[1]
        self.assertIn("false AS standard_seat_reconciled", sql)
        self.assertNotIn("Privilege Cloud Administrators", sql)

    def test_suspended_preset_filters_users_by_persisted_attribute(self):
        _, fetch = self._run_search(query="", node_types=("user",), status="suspended")
        sql = fetch.await_args.args[1]
        self.assertIn("coalesce(o.attributes->>'suspended', 'false') = 'true'", sql)
        self.assertIn("active_role.relationship_type = 'user_has_role'", sql)
        self.assertIn("active_role.lifecycle_status = 'active'", sql)
        self.assertEqual(fetch.await_args.args[2][2], "%%")

    def test_internal_scope_applies_the_same_predicates_as_global_search(self):
        _, fetch = self._run_search(include_internal=False)
        by_type = {call.args[2][1]: call.args[1] for call in fetch.await_args_list}
        self.assertIn("meta.inventory_scope", by_type["safe"])
        self.assertIn("role_grants_access", by_type["role"])
        self.assertIn("user_has_role", by_type["user"])


class PamChainExpandHttpTests(unittest.IsolatedAsyncioTestCase):
    """CHAIN-011: the optional q travels from the query string to the repository."""

    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")
        self.addAsyncCleanup(self.client.aclose)
        self.session = _AuthenticatedSession(self.stack, self.client)
        await self.session.login()
        self.session.set_permissions(["pam:catalogs_read"])

    async def test_query_is_trimmed_and_forwarded_to_the_repository(self):
        page = {"rows": [], "total": 0, "limit": 50, "offset": 0}
        with patch("app.cyberark.pam.api.routes.chains.get_actor_permissions", new=AsyncMock(return_value=[])), \
             patch("app.cyberark.pam.api.routes.chains.expand_chain_node", new=AsyncMock(return_value=page)) as expand:
            response = await self.client.get(
                "/api/chains/pam/expand",
                params={"type": "role", "id": 7, "direction": "forward", "q": "  Fin  "},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(expand.await_args.kwargs["query"], "Fin")

    async def test_query_over_the_length_limit_is_rejected(self):
        with patch("app.cyberark.pam.api.routes.chains.get_actor_permissions", new=AsyncMock(return_value=[])):
            response = await self.client.get(
                "/api/chains/pam/expand",
                params={"type": "role", "id": 7, "direction": "forward", "q": "x" * 161},
            )

        self.assertEqual(response.status_code, 422)


class ChainIdentityLinkTests(unittest.TestCase):
    """Relaciones: the Identity person and their PAM account are one node."""

    LINK = {"pam_object_id": 5, "identity_object_id": 70, "display_name": "Ada Lovelace",
            "raw_email": "ada@example.com", "basis": "email_exact"}

    def test_pam_user_rows_carry_the_linked_person_and_keep_their_pam_id(self):
        rows = [{"id": 5, "node_type": "user", "label": "ada@example.com"},
                {"id": 6, "node_type": "user", "label": "bob@example.com"},
                {"id": 9, "node_type": "safe", "label": "Finance"}]
        with patch("app.cyberark.pam.repositories.pam_chain_expand.identity_links_for_pam_users",
                   new=AsyncMock(return_value=[self.LINK])):
            asyncio.run(_annotate_identity(object(), rows))
        self.assertEqual(rows[0]["id"], 5)
        self.assertEqual(rows[0]["identity"], {
            "object_id": 70, "display_name": "Ada Lovelace", "email": "ada@example.com", "basis": "email_exact",
        })
        self.assertIsNone(rows[1]["identity"])
        self.assertNotIn("identity", rows[2])

    def test_identity_is_only_resolved_with_the_identity_permission(self):
        links = AsyncMock(return_value=[self.LINK])
        def page(*_):
            return [{"id": 5, "node_type": "user", "label": "a", "sublabel": "a", "forward_count": 1, "back_count": 0,
                     "relation_kind": "persisted", "basis": "user_has_role", "total_count": 1}]
        with patch("app.cyberark.pam.repositories.pam_chain_expand.identity_links_for_pam_users", new=links), \
             patch("app.cyberark.pam.repositories.pam_chain_expand.fetch_all", new=AsyncMock(side_effect=page)):
            plain = asyncio.run(expand_chain_node(object(), node_type="role", node_id=7, direction="back"))
            linked = asyncio.run(expand_chain_node(
                object(), node_type="role", node_id=7, direction="back", include_identity=True,
            ))
        self.assertNotIn("identity", plain["rows"][0])
        self.assertEqual(linked["rows"][0]["identity"]["display_name"], "Ada Lovelace")
        links.assert_awaited_once()

    def test_identity_person_is_no_longer_a_node_type(self):
        self.assertNotIn("identity_user", NODE_HOPS)
        self.assertNotIn("identity_user", SEARCH_TYPES)


class PamChainIdentityHttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")
        self.addAsyncCleanup(self.client.aclose)
        self.session = _AuthenticatedSession(self.stack, self.client)
        await self.session.login()
        self.session.set_permissions(["pam:catalogs_read"])

    async def test_identity_flag_follows_the_permission_on_search_expand_and_node(self):
        page = {"rows": [], "total": 0, "limit": 50, "offset": 0}
        for granted, expected in (([], False), (["identity:catalogs_read"], True), (["access:manage"], True)):
            with patch("app.cyberark.pam.api.routes.chains.get_actor_permissions", new=AsyncMock(return_value=granted)), \
                 patch("app.cyberark.pam.api.routes.chains.search_chain_nodes", new=AsyncMock(return_value={"query": "ada", "groups": {}})) as search, \
                 patch("app.cyberark.pam.api.routes.chains.expand_chain_node", new=AsyncMock(return_value=page)) as expand, \
                 patch("app.cyberark.pam.api.routes.chains.get_chain_node", new=AsyncMock(return_value=None)) as node:
                await self.client.get("/api/chains/pam/search", params={"q": "ada"})
                await self.client.get("/api/chains/pam/expand", params={"type": "role", "id": 7, "direction": "back"})
                await self.client.get("/api/chains/pam/node", params={"type": "user", "id": 5})
            for call in (search, expand, node):
                self.assertEqual(call.await_args.kwargs["include_identity"], expected)

    async def test_the_identity_person_is_serialized_inside_the_user_hop(self):
        identity = {"object_id": 70, "display_name": "Ada Lovelace", "email": "ada@example.com", "basis": "uuid_exact"}
        hop = {"node_type": "user", "id": 5, "label": "ada", "sublabel": "ada", "relation_kind": "persisted",
               "basis": "user_has_role", "forward_count": 1, "back_count": 0, "identity": identity}
        page = {"rows": [hop], "total": 1, "limit": 50, "offset": 0}
        with patch("app.cyberark.pam.api.routes.chains.get_actor_permissions", new=AsyncMock(return_value=["access:manage"])), \
             patch("app.cyberark.pam.api.routes.chains.expand_chain_node", new=AsyncMock(return_value=page)):
            response = await self.client.get("/api/chains/pam/expand", params={"type": "role", "id": 7, "direction": "back"})
        self.assertEqual(response.json()["rows"][0]["identity"], identity)


if __name__ == "__main__":
    unittest.main()
