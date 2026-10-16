import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.netskope.sse.repositories.netskope_queries import get_netskope_client_events, get_netskope_device_facets, get_netskope_device_history, get_netskope_duplicates, get_netskope_metrics, list_netskope_objects


SOURCE_OK = {"source_fresh": True, "source_status": "completed", "source_completed_at": None, "as_of": None}


class NetskopeQueryTests(unittest.TestCase):
    def test_selected_metrics_bound_sql_and_omit_unrequested_results(self):
        base = {
            "users_total": 9, "devices_total": 7, "devices_stale_30d": 3,
            "devices_with_observed_user": 5, "last_observed_at": None,
        }
        cases = (
            (["devices_total"], 1, 0, "devices_by_os"),
            (["devices_by_os", "devices_by_os"], 1, 1, "users_by_company"),
            (["devices_stale_30d"], 2, 0, "users_by_device_count"),
            (["devices_observed_user_matched"], 2, 0, "users_by_device_count"),
            (["users_recent_activity"], 2, 0, "devices_by_observed_user_status"),
            (["coverage_risk_devices_by_user"], 2, 0, "users_by_device_count"),
        )
        for widgets, one_budget, all_budget, omitted in cases:
            with self.subTest(widgets=widgets):
                aggregate = AsyncMock(return_value=base)
                distribution = AsyncMock(return_value=[])
                cross_one = AsyncMock(return_value={"status": {"matched": 2, "ambiguous": 1, "unmatched": 4}, "devices_active_total": 10})
                cross_all = AsyncMock(return_value=[])
                with patch("app.netskope.sse.repositories.netskope_metrics.fetch_one", aggregate), patch("app.netskope.sse.repositories.netskope_metrics.get_netskope_source_evidence", new=AsyncMock(return_value=SOURCE_OK)), patch(
                    "app.netskope.sse.repositories.netskope_metrics.fetch_all", distribution,
                ), patch("app.netskope.sse.repositories.netskope_cross_metrics.fetch_one", cross_one), patch(
                    "app.netskope.sse.repositories.netskope_cross_metrics.fetch_all", cross_all,
                ):
                    result = asyncio.run(get_netskope_metrics(object(), widgets=widgets))
                self.assertEqual(aggregate.await_count + cross_one.await_count, one_budget)
                self.assertEqual(distribution.await_count + cross_all.await_count, all_budget)
                self.assertEqual(result["devices_total"], 7)
                self.assertNotIn(omitted, result)
                if widgets == ["coverage_risk_devices_by_user"]:
                    self.assertEqual(result["devices_active_total"], 10)

    def test_metric_selection_rejects_unknown_and_non_inventory_widgets_before_sql(self):
        for widgets in (["not-a-widget"], ["alerts_7d"], ["alerts_by_severity"], []):
            with self.subTest(widgets=widgets), patch(
                "app.netskope.sse.repositories.netskope_metrics.fetch_one", new=AsyncMock(),
            ) as query:
                with self.assertRaises(ValueError):
                    asyncio.run(get_netskope_metrics(object(), widgets=widgets))
                query.assert_not_awaited()

    def test_device_history_is_scoped_and_ordered(self):
        snapshots = [{"snapshot_id": 2, "device_id": "device-1"}]
        fetch_all = AsyncMock(return_value=snapshots)

        with patch("app.netskope.sse.repositories.netskope_inventory.fetch_all", new=fetch_all):
            result = asyncio.run(get_netskope_device_history(object(), "device-1"))

        query, params = fetch_all.await_args.args[1], fetch_all.await_args.args[2]
        self.assertEqual(result, {"device_id": "device-1", "snapshots": snapshots})
        self.assertIn("FROM public.netskope_device_snapshots", query)
        self.assertIn("ORDER BY captured_at DESC", query)
        self.assertEqual(params, ("device-1", 20))

    def test_metrics_are_scoped_to_active_netskope_objects(self):
        row = {
            "users_total": 9,
            "devices_total": 7,
            "devices_stale_30d": 3,
            "devices_with_observed_user": 5,
            "last_observed_at": None,
        }
        fetch_one = AsyncMock(return_value=row)
        operating_systems = [{"key": "Windows", "count": 6}, {"key": "macOS", "count": 1}]
        fetch_all = AsyncMock(side_effect=[[{"metric": "devices_by_os", **bucket} for bucket in operating_systems], []])
        cross = AsyncMock(return_value={"devices_observed_user_matched": 3})

        with patch("app.netskope.sse.repositories.netskope_metrics.fetch_one", new=fetch_one), patch("app.netskope.sse.repositories.netskope_metrics.get_netskope_source_evidence", new=AsyncMock(return_value=SOURCE_OK)), patch(
            "app.netskope.sse.repositories.netskope_metrics.fetch_all", new=fetch_all,
        ), patch("app.netskope.sse.repositories.netskope_cross_metrics.get_netskope_cross_metrics", new=cross):
            result = asyncio.run(get_netskope_metrics(object()))

        query, params = fetch_one.await_args_list[0].args[1], fetch_one.await_args_list[0].args[2]
        os_query, os_params = fetch_all.await_args_list[0].args[1], fetch_all.await_args_list[0].args[2]
        self.assertEqual(result["devices_by_os"], operating_systems)
        # NSK-XMET-001: the cross KPIs share the metrics response.
        self.assertEqual(result["devices_observed_user_matched"], 3)
        # NSK-HB-001: no heartbeat metric; the stale count is its own query over old devices.
        self.assertNotIn("heartbeat_status", result)
        self.assertNotIn("heartbeat", query)
        self.assertEqual(result["devices_stale_30d"], 3)
        stale_query, stale_params = fetch_one.await_args_list[1].args[1], fetch_one.await_args_list[1].args[2]
        # One shared rule: a trusted timestamp (positive, not in the future) strictly older than the threshold.
        self.assertIn("make_interval(days => 30)", stale_query)
        self.assertIn("<= extract(epoch FROM now())", stale_query)
        self.assertIn("> 0", stale_query)
        self.assertNotIn("{STALE_DEVICE_CONDITION}", stale_query)
        self.assertEqual(stale_params, ("netskope",))
        self.assertIn("source_system = %s", query)
        self.assertIn("lifecycle_status = 'active'", query)
        # Regression: this WHERE clause interpolates RECENT_DEVICE_CONDITION via
        # an f-string. A plain triple-quoted string here sends the literal
        # placeholder text to Postgres and fails at runtime with a syntax
        # error, which a mocked fetch_one never catches.
        self.assertIn("last_event_timestamp", query)
        self.assertNotIn("{RECENT_DEVICE_CONDITION}", query)
        self.assertEqual(params, ("netskope",))
        self.assertIn("object_type = %s", os_query)
        self.assertIn("attributes->>'os'", os_query)
        self.assertEqual(os_params, ["netskope", "device", "netskope", "user", 8, 8, 8, 8, 8, 40, 40])
        self.assertIn("devices_by_company", result)
        self.assertIn("attributes->>'company'", os_query)

    def test_user_search_keeps_source_id_internal_but_searchable(self):
        fetch_all = AsyncMock(return_value=[])

        with patch("app.netskope.sse.repositories.netskope_inventory.fetch_all", new=fetch_all):
            result = asyncio.run(list_netskope_objects(object(), "user", "ada", 50, 0))

        query, params = fetch_all.await_args.args[1], fetch_all.await_args.args[2]
        self.assertEqual(result["total"], 0)
        self.assertIn("source_id ILIKE %s", query)
        self.assertIn("attributes->>'email' ILIKE %s", query)
        self.assertIn("attributes->>'company' ILIKE %s", query)
        self.assertEqual(params, ("netskope", "user", "%ada%", "%ada%", "%ada%", "%ada%", 50, 0, "netskope"))

    def test_the_heartbeat_filter_no_longer_exists(self):
        # NSK-HB-001: the flag is not a device state, so it is neither filtered nor echoed.
        fetch_all = AsyncMock(return_value=[])

        with patch("app.netskope.sse.repositories.netskope_inventory.fetch_all", new=fetch_all):
            result = asyncio.run(list_netskope_objects(object(), "device", "", 50, 0))

        self.assertNotIn("heartbeat", result)
        self.assertNotIn("heartbeat", fetch_all.await_args.args[1])
        with self.assertRaises(TypeError):
            asyncio.run(list_netskope_objects(object(), "device", "", 50, 0, heartbeat="inactive"))

    def test_device_user_correlation_is_applied_after_page_is_selected(self):
        fetch_all = AsyncMock(return_value=[])

        with patch("app.netskope.sse.repositories.netskope_inventory.fetch_all", new=fetch_all):
            asyncio.run(list_netskope_objects(object(), "device", "", 50, 0))

        query, params = fetch_all.await_args.args[1], fetch_all.await_args.args[2]
        self.assertIn("paged_devices AS MATERIALIZED", query)
        self.assertLess(query.index("LIMIT %s OFFSET %s"), query.index("LEFT JOIN LATERAL"))
        self.assertIn("LEFT JOIN paged_devices ON true", query)
        self.assertEqual(params, ("netskope", "device", 50, 0, "netskope"))

    def test_duplicate_quality_signal_defaults_to_the_full_inventory(self):
        fetch_one = AsyncMock(return_value={"groups": 0, "devices": 0, "largest": 0})
        fetch_all = AsyncMock(return_value=[])
        with patch("app.netskope.sse.repositories.netskope_inventory.fetch_one", new=fetch_one), patch(
            "app.netskope.sse.repositories.netskope_inventory.fetch_all", new=fetch_all,
        ):
            asyncio.run(get_netskope_duplicates(object()))

        self.assertNotIn("last_event_timestamp", fetch_one.await_args.args[1])
        self.assertNotIn("last_event_timestamp", fetch_all.await_args.args[1])


    def test_device_attribute_filters_use_the_metric_buckets_as_parameters(self):
        fetch_all = AsyncMock(return_value=[])

        with patch("app.netskope.sse.repositories.netskope_inventory.fetch_all", new=fetch_all):
            result = asyncio.run(list_netskope_objects(
                object(), "device", "", 50, 0,
                {"os": "Windows", "company": "ITTI", "client_version": "", "user_status": "Sin dato"},
            ))

        query, params = fetch_all.await_args.args[1], fetch_all.await_args.args[2]
        # Empty filters are dropped; the rest compare against the same
        # coalesce/'Sin dato' bucket the metrics charts group by.
        self.assertEqual(result["filters"], {"os": "Windows", "company": "ITTI", "user_status": "Sin dato"})
        self.assertIn("coalesce(nullif(btrim(attributes->>'os'), ''), 'Sin dato') = %s", query)
        self.assertIn("attributes->>'company'", query)
        self.assertNotIn("Windows", query)
        self.assertEqual(params, ("netskope", "device", "Windows", "ITTI", "Sin dato", 50, 0, "netskope"))

    def test_device_filters_reject_unknown_keys_and_user_scope(self):
        with patch("app.netskope.sse.repositories.netskope_inventory.fetch_all", new=AsyncMock(return_value=[])):
            with self.assertRaises(ValueError):
                asyncio.run(list_netskope_objects(object(), "device", "", 50, 0, {"serial_number": "x"}))
            with self.assertRaises(ValueError):
                asyncio.run(list_netskope_objects(object(), "user", "", 50, 0, {"os": "Windows"}))

    def test_device_facets_cover_every_filter_with_bounded_queries(self):
        fetch_all = AsyncMock(return_value=[{"key": "Windows", "count": 3}])

        with patch("app.netskope.sse.repositories.netskope_inventory.fetch_all", new=fetch_all):
            facets = asyncio.run(get_netskope_device_facets(object()))

        self.assertEqual(set(facets), {"os", "client_version", "classification_status", "user_status", "company", "last_seen_event", "device_make", "device_model"})
        for call in fetch_all.await_args_list:
            query, params = call.args[1], call.args[2]
            self.assertIn("object_type = 'device'", query)
            self.assertIn("lifecycle_status = 'active'", query)
            self.assertEqual(params, ("netskope", 200))

    def test_client_events_flag_only_the_exact_coverage_risk_literals(self):
        rows = [
            {"key": "Tunnel Down", "count": 50},
            {"key": "Disconnected By Uninstall", "count": 9},
            {"key": "Uninstalled", "count": 5},
            {"key": "Admin Disabled", "count": 2},
            {"key": "Admin Enabled", "count": 2},
            {"key": "uninstalled", "count": 1},
            {"key": "Sin dato", "count": 1},
        ]
        fetch_all = AsyncMock(return_value=rows)

        with patch("app.netskope.sse.repositories.netskope_inventory.fetch_all", new=fetch_all):
            result = asyncio.run(get_netskope_client_events(object()))

        flagged = {event["key"] for event in result["events"] if event["coverage_risk"]}
        # Exact literal match only: different casing or "Admin Enabled" are
        # not guessed to be a risk.
        self.assertEqual(flagged, {"Disconnected By Uninstall", "Uninstalled", "Admin Disabled"})
        self.assertEqual(result["coverage_risk_total"], 16)
        self.assertEqual(result["total"], 70)
        self.assertIn("attributes->>'last_seen_event'", fetch_all.await_args.args[1])

    def test_metrics_accept_allowlisted_widget_filters(self):
        row = {
            "users_total": 9, "devices_total": 7, "devices_stale_30d": 3,
            "devices_with_observed_user": 5, "last_observed_at": None,
        }
        fetch_one = AsyncMock(return_value=row)
        fetch_all = AsyncMock(side_effect=[[], [], [], [], [], [], [], []])
        cross = AsyncMock(return_value={})
        with patch("app.netskope.sse.repositories.netskope_metrics.fetch_one", new=fetch_one), patch("app.netskope.sse.repositories.netskope_metrics.get_netskope_source_evidence", new=AsyncMock(return_value=SOURCE_OK)), patch(
            "app.netskope.sse.repositories.netskope_metrics.fetch_all", new=fetch_all,
        ), patch("app.netskope.sse.repositories.netskope_cross_metrics.get_netskope_cross_metrics", new=cross):
            asyncio.run(get_netskope_metrics(object(), {"os": "Windows", "company": "ITTI"}))

        query, params = fetch_one.await_args_list[0].args[1], fetch_one.await_args_list[0].args[2]
        self.assertIn("coalesce(nullif(btrim(attributes->>'os'), ''), 'Sin dato') = %s", query)
        self.assertIn("upper(split_part", query)
        # Company filters both branches; os only the device branch.
        self.assertEqual(params, ("netskope", "ITTI", "Windows", "ITTI"))
        # The stale count takes the device filters too, never the user ones.
        self.assertEqual(fetch_one.await_args_list[1].args[2], ("netskope", "Windows", "ITTI"))
        device_params = fetch_all.await_args_list[0].args[2]
        self.assertEqual(device_params, ["netskope", "device", "Windows", "ITTI", "netskope", "user", "ITTI", 8, 8, 8, 8, 8, 40, 40])
        # NSK-INV-002: the metrics no longer read the manual diagnosis.
        self.assertFalse(any("netskope_device_reviews" in call.args[1] for call in fetch_all.await_args_list))

    def test_metrics_reject_unknown_filters(self):
        with self.assertRaises(ValueError):
            asyncio.run(get_netskope_metrics(object(), {"user_status": "active"}))


if __name__ == "__main__":
    unittest.main()
