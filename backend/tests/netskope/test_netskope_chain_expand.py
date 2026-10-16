"""Regression tests for the Netskope inventory chain (CHAIN-005)."""

import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.netskope.sse.repositories.netskope_chain_expand import (
    NETSKOPE_HOPS,
    expand_netskope_chain_node,
    get_netskope_chain_node,
    search_netskope_chain_nodes,
    user_matched_device_summary,
)
from app.netskope.sse.repositories.netskope_shared import RECENT_DEVICE_CONDITION


class NetskopeHopAllowlistTests(unittest.TestCase):
    def test_allowlist_matches_the_plan(self):
        self.assertEqual(NETSKOPE_HOPS, {
            "netskope_user": {"forward": ("netskope_device",), "back": ()},
            "netskope_device": {
                "forward": ("netskope_client_version", "netskope_os"),
                "back": ("netskope_user",),
            },
            "netskope_client_version": {"forward": (), "back": ()},
            "netskope_os": {"forward": (), "back": ()},
        })


class NetskopeExpandTests(unittest.TestCase):
    def test_user_forward_only_draws_matched_devices(self):
        user = {"object_id": 3, "display_name": "Ada", "source_id": "u-3", "email": "ada@example.com"}
        devices = [{"object_id": 9, "display_name": "Laptop", "source_id": "dev-9", "forward_count": 2, "total_count": 1}]
        with patch("app.netskope.sse.repositories.netskope_chain_expand.fetch_one", new=AsyncMock(return_value=user)), \
             patch("app.netskope.sse.repositories.netskope_chain_expand.fetch_all", new=AsyncMock(return_value=devices)) as fetch:
            result = asyncio.run(expand_netskope_chain_node(
                object(), node_type="netskope_user", node_id=3, direction="forward",
            ))

        self.assertEqual(result["rows"][0]["node_type"], "netskope_device")
        self.assertEqual(result["rows"][0]["basis"], "observed_user_exact")
        self.assertEqual(result["total"], 1)
        sql = fetch.await_args.args[1]
        self.assertIn("candidate_count = 1", sql)
        self.assertNotIn("user_key", sql)

    def test_device_back_matches_a_unique_user_only(self):
        device = {"object_id": 9, "display_name": "Laptop", "source_id": "dev-9", "attributes": {"username": "ada@example.com"}}
        user = {"object_id": 3, "display_name": "Ada", "source_id": "u-3", "email": "ada@example.com"}
        with patch("app.netskope.sse.repositories.netskope_chain_expand.fetch_one", new=AsyncMock(return_value=device)), \
             patch("app.netskope.sse.repositories.netskope_chain_expand.fetch_all", new=AsyncMock(return_value=[user])) as fetch, \
             patch("app.netskope.sse.repositories.netskope_chain_expand._user_matched_devices", new=AsyncMock(return_value={"rows": [], "total": 1})):
            result = asyncio.run(expand_netskope_chain_node(
                object(), node_type="netskope_device", node_id=9, direction="back",
            ))

        self.assertEqual(result["rows"][0]["node_type"], "netskope_user")
        self.assertEqual(result["rows"][0]["basis"], "observed_user_exact")
        self.assertNotIn("user_key", fetch.await_args.args[1])

    def test_device_back_never_draws_an_ambiguous_user(self):
        device = {"object_id": 9, "display_name": "Laptop", "source_id": "dev-9", "attributes": {"username": "shared@example.com"}}
        with patch("app.netskope.sse.repositories.netskope_chain_expand.fetch_one", new=AsyncMock(return_value=device)), \
             patch("app.netskope.sse.repositories.netskope_chain_expand.fetch_all", new=AsyncMock(return_value=[
                 {"object_id": 3, "display_name": "Ada", "source_id": "u-3", "email": "shared@example.com"},
                 {"object_id": 4, "display_name": "Bob", "source_id": "u-4", "email": "shared@example.com"},
             ])):
            result = asyncio.run(expand_netskope_chain_node(
                object(), node_type="netskope_device", node_id=9, direction="back",
            ))

        self.assertEqual(result["rows"], [])
        self.assertEqual(result["total"], 0)

    def test_device_forward_returns_attribute_groups_not_relations(self):
        row = {"client_version": "110.0.1", "os": "Windows", "os_version": "11"}
        with patch("app.netskope.sse.repositories.netskope_chain_expand.fetch_all", new=AsyncMock(return_value=[row])):
            result = asyncio.run(expand_netskope_chain_node(
                object(), node_type="netskope_device", node_id=9, direction="forward",
            ))

        by_type = {hop["node_type"]: hop for hop in result["rows"]}
        self.assertEqual(set(by_type), {"netskope_client_version", "netskope_os"})
        self.assertEqual(by_type["netskope_client_version"]["basis"], "attribute_group")
        self.assertEqual(by_type["netskope_client_version"]["label"], "110.0.1")
        self.assertEqual(by_type["netskope_os"]["sublabel"], "11")
        self.assertEqual(by_type["netskope_client_version"]["relation_kind"], "derived")

    def test_version_and_os_groups_are_terminal(self):
        with patch("app.netskope.sse.repositories.netskope_chain_expand.fetch_all", new=AsyncMock()) as fetch:
            result = asyncio.run(expand_netskope_chain_node(
                object(), node_type="netskope_client_version", node_id=0, direction="forward",
            ))
        self.assertEqual(result["rows"], [])
        fetch.assert_not_awaited()


class NetskopeNodeTests(unittest.TestCase):
    def test_user_node_counts_matched_devices(self):
        row = {"id": 3, "node_type": "user", "label": "Ada", "sublabel": "u-3", "email": "ada@example.com"}
        with patch("app.netskope.sse.repositories.netskope_chain_expand.fetch_one", new=AsyncMock(return_value=row)), \
             patch("app.netskope.sse.repositories.netskope_chain_expand._user_matched_devices", new=AsyncMock(return_value={"rows": [], "total": 4})):
            result = asyncio.run(get_netskope_chain_node(object(), node_type="netskope_user", node_id=3))

        self.assertEqual(result["node_type"], "netskope_user")
        self.assertEqual(result["forward_count"], 4)
        self.assertEqual(result["back_count"], 0)

    def test_device_node_counts_groups_and_observed_user(self):
        node_row = {"id": 9, "node_type": "device", "label": "Laptop", "sublabel": "dev-9", "attributes": {"username": "ada@example.com"}}
        device_row = {"object_id": 9, "display_name": "Laptop", "source_id": "dev-9", "attributes": {"username": "ada@example.com"}}
        with patch("app.netskope.sse.repositories.netskope_chain_expand.fetch_one", new=AsyncMock(side_effect=[node_row, device_row])), \
             patch("app.netskope.sse.repositories.netskope_chain_expand.fetch_all", new=AsyncMock(side_effect=[
                 [{"client_version": "110.0.1", "os": "Windows", "os_version": "11"}],
                 [{"object_id": 3, "display_name": "Ada", "source_id": "u-3", "email": "ada@example.com"}],
             ])), \
             patch("app.netskope.sse.repositories.netskope_chain_expand._user_matched_devices", new=AsyncMock(return_value={"rows": [], "total": 2})):
            result = asyncio.run(get_netskope_chain_node(object(), node_type="netskope_device", node_id=9))

        self.assertEqual(result["node_type"], "netskope_device")
        self.assertEqual(result["forward_count"], 2)
        self.assertEqual(result["back_count"], 1)

    def test_observed_user_count_shares_the_expansion_filter(self):
        """The device -> user hop's count must come from the same 1-to-1
        predicate as the expansion, never from a divergent query."""
        device = {"object_id": 9, "display_name": "Laptop", "source_id": "dev-9", "attributes": {"username": "shared@example.com"}}
        user = {"object_id": 3, "display_name": "Ada", "source_id": "u-3", "email": "shared@example.com"}
        pool = object()
        with patch("app.netskope.sse.repositories.netskope_chain_expand.fetch_one", new=AsyncMock(return_value=device)), \
             patch("app.netskope.sse.repositories.netskope_chain_expand.fetch_all", new=AsyncMock(return_value=[user])), \
             patch("app.netskope.sse.repositories.netskope_chain_expand._user_matched_devices", new=AsyncMock(return_value={"rows": [], "total": 7})) as matched:
            result = asyncio.run(expand_netskope_chain_node(
                pool, node_type="netskope_device", node_id=9, direction="back",
            ))

        self.assertEqual(result["rows"][0]["forward_count"], 7)
        matched.assert_awaited_once_with(pool, user_object_id=3, limit=1, offset=0)

    def test_synthetic_groups_have_no_node(self):
        self.assertIsNone(asyncio.run(get_netskope_chain_node(object(), node_type="netskope_os", node_id=0)))


class NetskopeSearchTests(unittest.TestCase):
    def test_groups_and_escapes_like_wildcards(self):
        def fake_fetch(pool, sql, params):
            return [{"id": 1, "label": "Ada", "sublabel": "u1"}]

        with patch("app.netskope.sse.repositories.netskope_chain_expand.fetch_all", new=AsyncMock(side_effect=fake_fetch)) as fetch:
            result = asyncio.run(search_netskope_chain_nodes(
                object(), query="100%_off", node_types=("netskope_user", "netskope_device"),
            ))

        self.assertEqual(list(result["groups"]), ["netskope_user", "netskope_device"])
        first_params = fetch.await_args_list[0].args[2]
        self.assertEqual(first_params[1], "%100\\%\\_off%")
        self.assertEqual(first_params[0], "netskope")


if __name__ == "__main__":
    unittest.main()


class NetskopePersonDeviceSummaryTests(unittest.TestCase):
    """CHAIN-010: the person view counts devices like the inventory does."""

    def _run(self, row):
        fetch_one = AsyncMock(return_value=row)
        with patch("app.netskope.sse.repositories.netskope_chain_expand.fetch_one", new=fetch_one):
            result = asyncio.run(user_matched_device_summary(object(), {"source_id": "u-1", "email": "ada@example.com"}))
        return result, fetch_one.await_args.args[1]

    def test_recent_and_stale_devices_are_counted_apart(self):
        result, sql = self._run({
            "device_count": 2, "stale_device_count": 1,
            "client_versions": ["141.1.0.2817"], "operating_systems": ["Windows", "Mac"],
        })

        self.assertEqual(result["device_count"], 2)
        self.assertEqual(result["stale_device_count"], 1)
        self.assertEqual(result["operating_systems"], ["Mac", "Windows"])
        # Same 7-day rule as the inventory's default "Sólo recientes" filter;
        # a device without a numeric timestamp counts as stale, never recent.
        self.assertIn(RECENT_DEVICE_CONDITION, sql)
        self.assertIn(f"coalesce(({RECENT_DEVICE_CONDITION}), false) AS recent", sql)
        self.assertIn("count(*) FILTER (WHERE NOT recent)", sql)
        # Versions and OS come from recent devices, grouped without the
        # architecture suffix.
        self.assertIn("FILTER (WHERE recent AND nullif(btrim(client_version), '') IS NOT NULL)", sql)
        self.assertIn(r"regexp_replace(client_version, '\s*\((32|64)-bit\)\s*$', '')", sql)

    def test_no_devices_is_an_empty_summary(self):
        result, _ = self._run(None)

        self.assertEqual(result, {"device_count": 0, "stale_device_count": 0, "client_versions": [], "operating_systems": []})
