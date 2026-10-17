import asyncio
import json
import unittest
from uuid import uuid4
from unittest.mock import AsyncMock, patch

import httpx

from app.netskope.sse.integrations.netskope import ADEM_POPLIST_PATH, DEM_SITES_PATH, GROUPS_PATH, NetskopeClient, NetskopeError, NetskopeNotConfigured, NetskopeSettings, netskope_alerts_configured, netskope_dlp_alert_export_configured, netskope_dlp_incidents_configured, netskope_groups_configured
from app.netskope.sse.services.netskope_mapping import map_netskope_dem_sites, map_netskope_objects


class NetskopeSyncTests(unittest.TestCase):
    def test_alert_windows_persist_count_only_rows_even_when_total_is_zero(self):
        from app.netskope.sse.integrations.netskope import NetskopeSettings
        from app.netskope.sse.netskope_sync import sync_netskope_alerts

        settings = NetskopeSettings(
            base_url="https://tenant.goskope.com", api_token="secret-token",
            device_status_path="/devices", users_path="/users", user_counts_path="/counts",
            alert_path="/api/v2/events/datasearch/alert",
        )

        class FakeClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return None

            async def get_users(self):
                return []

            async def get_devices(self):
                return []

            async def get_alert_aggregates(self, _starttime, _endtime, dimension=None):
                if dimension is None:
                    return []
                if dimension == "severity":
                    raise AssertionError("Severity must come from AA, not the sync")
                if dimension == "action":
                    return [{"key": "", "count": 3}]
                return [{"key": "DLP", "count": 2}]

        record_alerts = AsyncMock()
        purge_alerts = AsyncMock()
        sync_inventory = AsyncMock()
        capture_dlp = AsyncMock()
        with (
            patch("app.netskope.sse.netskope_sync.NetskopeSettings.from_environment", return_value=settings),
            patch("app.netskope.sse.netskope_sync.NetskopeClient", return_value=FakeClient()),
            patch("app.netskope.sse.netskope_sync.record_alert_aggregates", new=record_alerts),
            patch("app.netskope.sse.netskope_sync.purge_netskope_alert_aggregates", new=purge_alerts),
            patch("app.netskope.sse.netskope_sync.sync_inventory_snapshot", new=sync_inventory),
            patch("app.netskope.sse.netskope_sync.capture_netskope_dlp_alerts", new=capture_dlp),
        ):
            result = asyncio.run(sync_netskope_alerts(AsyncMock(), uuid4()))

        # SYNC-TASK-001: the alerts task touches neither inventory nor DLP.
        self.assertEqual(result, {"objects": 15, "relationships": 0})
        sync_inventory.assert_not_awaited()
        capture_dlp.assert_not_awaited()
        rows = record_alerts.await_args.args[2]
        self.assertEqual(len(rows), 15)
        # NSK-POL-002: one marker per window says the policy dimension was
        # captured, even when no policy fired.
        self.assertEqual(
            {(row["window_days"], row["dimension"]) for row in rows},
            {(days, dimension) for days in (7, 30, 90) for dimension in ("total", "alert_type", "action", "policy", "policy_capture")},
        )
        self.assertEqual([row["alert_count"] for row in rows if row["dimension"] == "policy_capture"], [0, 0, 0])
        # Migration 060 forbids an empty value outside `total`, so the marker has one.
        self.assertEqual({row["dimension_value"] for row in rows if row["dimension"] == "policy_capture"}, {"captured"})
        self.assertEqual([row["alert_count"] for row in rows if row["dimension"] == "total"], [0, 0, 0])
        # NSK-POL-001: policy is requested and persisted as an observed-only
        # dimension, without changing the global action buckets.
        self.assertEqual(
            [row["dimension_value"] for row in rows if row["dimension"] == "policy"],
            ["DLP", "DLP", "DLP"],
        )
        # NSK-ALR-001: the 180-day purge runs right after recording, so each
        # run that writes aggregates also ages out the expired snapshots.
        purge_alerts.assert_awaited_once()
        self.assertEqual(purge_alerts.await_args.args[1], 180)
        self.assertEqual(
            [row["dimension_value"] for row in rows if row["dimension"] == "action"],
            ["Sin dato", "Sin dato", "Sin dato"],
        )


class NetskopeHttpTests(unittest.TestCase):
    def test_adem_device_queries_reject_ambiguous_ids_and_invalid_timestamps(self):
        for payload, method in (([{'deviceId': 'id'}, {'deviceId': 'id'}], 'list'),
                                ([{'deviceId': 70}], 'list'),
                                ({'lastActivity': True}, 'details'),
                                ({'lastActivity': 1790700010000}, 'details'),
                                ({'pop': ['AR-BUE1']}, 'details')):
            with self.subTest(payload=payload):
                client = httpx.AsyncClient(transport=httpx.MockTransport(lambda request, payload=payload: httpx.Response(200, json=payload)))
                async def exercise(client=client, method=method):
                    async with NetskopeClient(self.settings(), client) as netskope:
                        if method == 'list':
                            await netskope.get_adem_devices('person@example.test', 1000, 4600)
                        else:
                            await netskope.get_adem_device_details('person@example.test', 'id', 1000, 4600)
                with self.assertRaises(NetskopeError):
                    asyncio.run(exercise())
                asyncio.run(client.aclose())

    def test_adem_device_queries_preserve_ids_and_discard_sensitive_fields(self):
        requests = []
        def handler(request):
            requests.append((request.url.path, json.loads(request.content)))
            if request.url.path.endswith('getlist'):
                return httpx.Response(200, json=[{'deviceId': 'opaque:70', 'deviceName': 'Laptop', 'deviceOs': 'Linux', 'publicIp': 'sensitive'}])
            return httpx.Response(200, json={'pop': 'AR-BUE1', 'lastActivity': 1790700010, 'publicIp': 'sensitive', 'privateIp': 'sensitive', 'geo': {'latitude': 1}, 'gateway': 'private-host'})
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        async def exercise():
            async with NetskopeClient(self.settings(), client) as netskope:
                devices = await netskope.get_adem_devices('user@example.test', 1790700000, 1790707200)
                detail = await netskope.get_adem_device_details('user@example.test', devices[0]['device_id'], 1790700000, 1790707200)
                return devices, detail
        devices, detail = asyncio.run(exercise())
        asyncio.run(client.aclose())
        self.assertEqual(devices, [{'device_id': 'opaque:70', 'device_name': 'Laptop', 'device_os': 'Linux'}])
        self.assertEqual(detail, {'pop': 'AR-BUE1', 'last_activity': 1790700010})
        self.assertEqual(requests, [
            ('/api/v2/adem/users/device/getlist', {'user': 'user@example.test', 'starttime': 1790700000, 'endtime': 1790707200, 'userLocation': []}),
            ('/api/v2/adem/users/device/getdetails', {'user': 'user@example.test', 'deviceId': 'opaque:70', 'starttime': 1790700000, 'endtime': 1790707200}),
        ])

    def test_adem_poplist_reads_only_pop_codes_in_bounded_window(self):
        requests = []
        def handler(request):
            requests.append((request.method, request.url.path, dict(request.url.params)))
            return httpx.Response(200, json={"pops": ["AR-BUE1", "BR-SAO1"], "totalCount": 2})
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        async def exercise():
            async with NetskopeClient(self.settings(), client) as netskope:
                return await netskope.get_adem_pops(1000, 4600)
        self.assertEqual(asyncio.run(exercise()), ["AR-BUE1", "BR-SAO1"])
        asyncio.run(client.aclose())
        self.assertEqual(requests, [("GET", ADEM_POPLIST_PATH, {"starttime": "1000", "endtime": "4600"})])

    def test_adem_poplist_rejects_invalid_window_and_user_shaped_payload(self):
        requests = []
        client = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: (
            requests.append(request.url.path) or httpx.Response(200, json={"users": [{"name": "not approved"}], "totalCount": 1})
        )))
        async def exercise():
            async with NetskopeClient(self.settings(), client) as netskope:
                with self.assertRaises(NetskopeError):
                    await netskope.get_adem_pops(0, 49 * 3600)
                with self.assertRaises(NetskopeError):
                    await netskope.get_adem_pops(1000, 4600)
        asyncio.run(exercise())
        asyncio.run(client.aclose())
        self.assertEqual(requests, [ADEM_POPLIST_PATH])

    def test_dem_sites_reads_only_approved_get_array(self):
        requests = []
        def handler(request):
            requests.append((request.method, request.url.path))
            return httpx.Response(200, json=[{"id": "site:1", "name": "Site 1"}])
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        settings = NetskopeSettings(**{**self.settings().__dict__, "dem_sites_path": DEM_SITES_PATH})
        async def exercise():
            async with NetskopeClient(settings, client) as netskope:
                return await netskope.get_dem_sites()
        self.assertEqual(asyncio.run(exercise()), [{"id": "site:1", "name": "Site 1"}])
        asyncio.run(client.aclose())
        self.assertEqual(requests, [("GET", DEM_SITES_PATH)])

    def test_dem_sites_rejects_unexpected_envelope(self):
        client = httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"data": []})))
        settings = NetskopeSettings(**{**self.settings().__dict__, "dem_sites_path": DEM_SITES_PATH})
        async def exercise():
            async with NetskopeClient(settings, client) as netskope:
                await netskope.get_dem_sites()
        with self.assertRaises(NetskopeError):
            asyncio.run(exercise())
        asyncio.run(client.aclose())

    def groups_client(self, handler):
        settings = NetskopeSettings(**{**self.settings().__dict__, "groups_path": GROUPS_PATH, "users_page_size": 2, "page_delay_seconds": 0})
        return settings, httpx.AsyncClient(transport=httpx.MockTransport(handler))

    def test_groups_are_read_by_post_query_pages_until_total_results(self):
        import json
        bodies = []
        pages = {0: ["g1", "g2"], 2: ["g3"]}
        def handler(request):
            body = json.loads(request.content)
            bodies.append((request.method, request.url.path, body["query"]["paging"]))
            offset = body["query"]["paging"]["offset"]
            return httpx.Response(200, json={"counts": {"totalResults": 3, "offset": offset}, "data": [{"id": item, "displayName": item} for item in pages[offset]]})
        settings, client = self.groups_client(handler)
        async def exercise():
            async with NetskopeClient(settings, client) as netskope:
                return await netskope.get_groups()
        self.assertEqual([group["id"] for group in asyncio.run(exercise())], ["g1", "g2", "g3"])
        asyncio.run(client.aclose())
        self.assertEqual(bodies, [("POST", GROUPS_PATH, {"offset": 0, "limit": 2}), ("POST", GROUPS_PATH, {"offset": 2, "limit": 2})])

    def test_groups_reject_incomplete_or_ambiguous_reads(self):
        cases = {
            "no total": {"counts": {"offset": 0}, "data": [{"id": "g1"}]},
            "wrong offset": {"counts": {"totalResults": 1, "offset": 5}, "data": [{"id": "g1"}]},
            "empty page before total": {"counts": {"totalResults": 2, "offset": 0}, "data": []},
            "not a list": {"counts": {"totalResults": 1, "offset": 0}, "data": {"id": "g1"}},
            "invalid item": {"counts": {"totalResults": 1, "offset": 0}, "data": ["g1"]},
        }
        for label, payload in cases.items():
            settings, client = self.groups_client(lambda _request, payload=payload: httpx.Response(200, json=payload))
            async def exercise(settings=settings, client=client):
                async with NetskopeClient(settings, client) as netskope:
                    await netskope.get_groups()
            with self.subTest(label), self.assertRaises(NetskopeError):
                asyncio.run(exercise())
            asyncio.run(client.aclose())

    def test_groups_need_the_approved_route_and_users_always_project_accounts(self):
        with patch.dict("os.environ", {}, clear=True):
            self.assertFalse(netskope_groups_configured())
        with patch.dict("os.environ", {"NETSKOPE_GROUPS_PATH": "/api/v2/scim/Groups"}, clear=True):
            self.assertFalse(netskope_groups_configured())
        with patch.dict("os.environ", {"NETSKOPE_GROUPS_PATH": GROUPS_PATH}, clear=True):
            self.assertTrue(netskope_groups_configured())
        client = httpx.AsyncClient(transport=httpx.MockTransport(lambda _request: httpx.Response(500)))
        async def exercise():
            async with NetskopeClient(self.settings(), client) as netskope:
                await netskope.get_groups()
        with self.assertRaises(NetskopeNotConfigured):
            asyncio.run(exercise())
        asyncio.run(client.aclose())
        import json
        projections = []
        def handler(request):
            projections.append(json.loads(request.content)["query"]["projection"])
            return httpx.Response(200, json={"counts": {"totalResults": 0, "offset": 0}, "data": []})
        # NSK-USR-001: accounts[] carries active/deleted, so it is requested with or without the groups layer.
        for groups_path, expected in (("", True), (GROUPS_PATH, True)):
            settings = NetskopeSettings(**{**self.settings().__dict__, "groups_path": groups_path, "page_delay_seconds": 0})
            client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
            async def users(settings=settings, client=client):
                async with NetskopeClient(settings, client) as netskope:
                    await netskope.get_users()
            asyncio.run(users())
            asyncio.run(client.aclose())
            self.assertEqual("accounts" in projections[-1], expected)

    def test_alert_configuration_requires_the_count_only_datasearch_path(self):
        with patch.dict("os.environ", {}, clear=True):
            self.assertFalse(netskope_alerts_configured())
        with patch.dict("os.environ", {"NETSKOPE_DLP_ALERTS_PATH": "/api/v2/events/dataexport/alerts/dlp"}, clear=True):
            self.assertFalse(netskope_alerts_configured())
            self.assertTrue(netskope_dlp_alert_export_configured())
        with patch.dict("os.environ", {"NETSKOPE_ALERT_PATH": "/api/v2/events/datasearch/alert"}, clear=True):
            self.assertTrue(netskope_alerts_configured())

    def test_dlp_incident_path_is_only_enabled_for_the_approved_route(self):
        # NSK-DLP-001: the client reads the configured incident path, but only
        # the probe-approved route enables capture; any other value stays
        # inert instead of pointing at a broader raw export.
        environment = {
            "NETSKOPE_URL": "https://tenant.goskope.com",
            "NETSKOPE_DEVICE_STATUS_PATH": "/devices",
            "NETSKOPE_USERS_PATH": "/users",
            "NETSKOPE_USER_COUNTS_PATH": "/counts",
            "NETSKOPE_DLP_ALERTS_PATH": "/api/v2/events/dataexport/alerts/dlp",
            "NETSKOPE_DLP_INCIDENTS_PATH": "/api/v2/events/dataexport/events/incident",
        }
        with patch.dict("os.environ", environment, clear=True), patch(
            "app.netskope.sse.integrations.netskope.secret_from_environment", return_value="token",
        ):
            settings = NetskopeSettings.from_environment()
            approved = netskope_dlp_incidents_configured()
        self.assertEqual(settings.dlp_incidents_path, "/api/v2/events/dataexport/events/incident")
        self.assertTrue(approved)

        with patch.dict("os.environ", {**environment, "NETSKOPE_DLP_INCIDENTS_PATH": "/api/v2/events/dataexport/alerts/content"}, clear=True):
            self.assertFalse(netskope_dlp_incidents_configured())
        with patch.dict("os.environ", {}, clear=True):
            self.assertFalse(netskope_dlp_incidents_configured())

    def settings(self):
        return NetskopeSettings(
            base_url="https://tenant.goskope.com", api_token="secret-token",
            device_status_path="/api/v2/events/datasearch/clientstatus",
            users_path="/api/v2/users/getusers", user_counts_path="/api/v2/users/counts",
            users_page_size=2, devices_page_size=2,
            alert_path="/api/v2/events/datasearch/alert",
        )

    def test_users_use_documented_nested_paging_and_projection(self):
        bodies = []

        def handler(request):
            self.assertEqual(request.headers["Netskope-API-Token"], "secret-token")
            if request.method == "POST":
                body = json.loads(request.content)
                bodies.append(body)
                offset = body["query"]["paging"]["offset"]
                page = [{"id": f"u{offset}"}, {"id": f"u{offset + 1}"}] if offset == 0 else [{"id": "u2"}]
                return httpx.Response(200, json={"counts": {"totalResults": 3, "offset": offset, "itemsPerPage": len(page)}, "data": page})
            return httpx.Response(200, json={})

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with NetskopeClient(self.settings(), client) as netskope:
                return await netskope.get_users()

        users = asyncio.run(exercise())
        asyncio.run(client.aclose())
        self.assertEqual([user["id"] for user in users], ["u0", "u1", "u2"])
        self.assertEqual(bodies[1]["query"]["paging"], {"offset": 2, "limit": 2})
        self.assertEqual(bodies[0]["query"]["projection"], ["id", "givenName", "familyName", "emails", "accounts"])

    def test_devices_use_query_pagination(self):
        urls = []

        def handler(request):
            urls.append(str(request.url))
            offset = int(request.url.params.get("offset", "0"))
            page = [{"device_id": f"d{offset}"}, {"device_id": f"d{offset + 1}"}] if offset == 0 else [{"device_id": "d2"}]
            return httpx.Response(200, json={"result": page, "status": {"count": len(page)}})

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with NetskopeClient(self.settings(), client) as netskope:
                return await netskope.get_devices()

        devices = asyncio.run(exercise())
        asyncio.run(client.aclose())
        self.assertEqual([device["device_id"] for device in devices], ["d0", "d1", "d2"])
        self.assertEqual(urls, [
            "https://tenant.goskope.com/api/v2/events/datasearch/clientstatus?offset=0&limit=2",
            "https://tenant.goskope.com/api/v2/events/datasearch/clientstatus?offset=2&limit=2",
        ])

    def test_retries_http_200_control_response(self):
        calls = 0

        def handler(request):
            nonlocal calls
            calls += 1
            if calls == 1:
                return httpx.Response(200, json={"message": "rate limited"})
            return httpx.Response(200, json={"counts": {"totalResults": 0, "offset": 0, "itemsPerPage": 2}, "data": []})

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with NetskopeClient(self.settings(), client) as netskope:
                return await netskope.get_users()

        self.assertEqual(asyncio.run(exercise()), [])
        asyncio.run(client.aclose())
        self.assertEqual(calls, 2)

    def test_retries_429_with_retry_after_header(self):
        calls = 0

        def handler(request):
            nonlocal calls
            calls += 1
            if calls == 1:
                return httpx.Response(429, headers={"retry-after": "2.5"}, text="slow down")
            return httpx.Response(200, json={"counts": {"totalResults": 0, "offset": 0, "itemsPerPage": 2}, "data": []})

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        sleep = AsyncMock()

        async def exercise():
            async with NetskopeClient(self.settings(), client) as netskope:
                return await netskope.get_users()

        with patch("app.netskope.sse.integrations.netskope.asyncio.sleep", new=sleep):
            self.assertEqual(asyncio.run(exercise()), [])
        asyncio.run(client.aclose())
        self.assertEqual(calls, 2)
        sleep.assert_awaited_once_with(2.5)

    def test_users_continue_after_short_intermediate_page(self):
        requested_offsets = []

        def handler(request):
            payload = json.loads(request.content)
            offset = payload["query"]["paging"]["offset"]
            requested_offsets.append(offset)
            pages = {0: [{"id": "u0"}, {"id": "u1"}], 2: [{"id": "u2"}], 3: [{"id": "u4"}, {"id": "u5"}]}
            page = pages[offset]
            return httpx.Response(200, json={"counts": {"totalResults": 5, "offset": offset, "itemsPerPage": 2}, "data": page})

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with NetskopeClient(self.settings(), client) as netskope:
                return await netskope.get_users()

        users = asyncio.run(exercise())
        asyncio.run(client.aclose())
        self.assertEqual(requested_offsets, [0, 2, 3])
        self.assertEqual([user["id"] for user in users], ["u0", "u1", "u2", "u4", "u5"])

    def test_alert_aggregates_request_only_count_and_allowlisted_dimension(self):
        def handler(request):
            self.assertEqual(request.method, "GET")
            self.assertEqual(request.url.path, "/api/v2/events/datasearch/alert")
            self.assertEqual(request.url.params["starttime"], "100")
            self.assertEqual(request.url.params["endtime"], "200")
            self.assertEqual(request.url.params["groupbys"], "alert_type")
            self.assertEqual(request.url.params["fields"], "count_total:count(id)")
            return httpx.Response(200, json={"result": [{"_id": "DLP", "count_total": 7}], "status": {}})

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with NetskopeClient(self.settings(), client) as netskope:
                return await netskope.get_alert_aggregates(100, 200, "alert_type")

        self.assertEqual(asyncio.run(exercise()), [{"key": "DLP", "count": 7}])
        asyncio.run(client.aclose())

    def test_alert_aggregates_accept_nested_group_key_returned_by_tenant(self):
        def handler(_request):
            return httpx.Response(
                200,
                json={"result": [{"_id": {"severity": "high"}, "count_total": 11}], "status": {}},
            )

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with NetskopeClient(self.settings(), client) as netskope:
                return await netskope.get_alert_aggregates(100, 200, "severity")

        self.assertEqual(asyncio.run(exercise()), [{"key": "high", "count": 11}])
        asyncio.run(client.aclose())

    def test_alert_aggregates_reject_unsafe_dimension_and_invalid_window(self):
        async def exercise():
            async with NetskopeClient(self.settings(), httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200, json={})))) as netskope:
                with self.assertRaises(NetskopeError):
                    await netskope.get_alert_aggregates(100, 200, "user")
                with self.assertRaises(NetskopeError):
                    await netskope.get_alert_aggregates(200, 100)

        asyncio.run(exercise())

    def test_dlp_incident_page_uses_the_approved_route_and_iterator(self):
        def handler(request):
            self.assertEqual(request.method, "GET")
            self.assertEqual(request.url.path, "/api/v2/events/dataexport/events/incident")
            self.assertEqual(request.url.params["operation"], "next")
            self.assertEqual(request.url.params["index"], "custodia-dlp-test")
            return httpx.Response(200, json={"result": [{"dlp_incident_id": 7}], "timestamp_hwm": 1720003600})

        settings = NetskopeSettings(**{
            **self.settings().__dict__,
            "dlp_incidents_path": "/api/v2/events/dataexport/events/incident",
        })
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with NetskopeClient(settings, client) as netskope:
                return await netskope.get_dlp_incident_page("next", "custodia-dlp-test")

        payload = asyncio.run(exercise())
        asyncio.run(client.aclose())
        self.assertEqual(payload["result"], [{"dlp_incident_id": 7}])

    def test_incident_uncertain_response_replays_last_page_instead_of_advancing(self):
        for failure in ("timeout", "server_error", "conflict", "invalid_json", "control"):
            with self.subTest(failure=failure):
                operations = []

                def handler(request, operations=operations, failure=failure):
                    operations.append(request.url.params["operation"])
                    if len(operations) == 1:
                        # The remote cursor may have advanced before the failure.
                        if failure == "timeout":
                            raise httpx.ReadTimeout("response lost", request=request)
                        if failure == "server_error":
                            return httpx.Response(503)
                        if failure == "conflict":
                            return httpx.Response(409, json={"message": "Concurrency conflict, retry later"})
                        if failure == "invalid_json":
                            return httpx.Response(200, text="unreadable response")
                        return httpx.Response(200, json={"message": "no data"})
                    return httpx.Response(200, json={"result": [{"dlp_incident_id": 7}], "timestamp_hwm": 1720003600})

                settings = NetskopeSettings(**{
                    **self.settings().__dict__, "dlp_incidents_path": "/api/v2/events/dataexport/events/incident",
                })

                async def exercise(settings=settings, handler=handler):
                    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
                        async with NetskopeClient(settings, http) as client:
                            payload = await client.get_dlp_incident_page("next", "isolated-index")
                            self.assertEqual(client.request_count, 2)
                            self.assertEqual(client.retry_count, 1)
                            return payload

                with patch("app.netskope.sse.integrations.netskope.asyncio.sleep", new=AsyncMock()) as sleep:
                    payload = asyncio.run(exercise())
                if failure in ("server_error", "conflict"):
                    sleep.assert_awaited_once_with(5)
                self.assertEqual(operations, ["next", "resend"])
                self.assertEqual(payload["result"], [{"dlp_incident_id": 7}])

    def test_incident_iterator_reports_retryable_http_status_after_exhaustion(self):
        for status_code in (409, 429, 503):
            with self.subTest(status_code=status_code):
                def handler(_request, status_code=status_code):
                    return httpx.Response(status_code, text="sensitive response body")

                settings = NetskopeSettings(**{
                    **self.settings().__dict__, "dlp_incidents_path": "/api/v2/events/dataexport/events/incident",
                })

                async def exercise(settings=settings, handler=handler):
                    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
                        async with NetskopeClient(settings, http) as client:
                            await client.get_dlp_incident_page("next", "isolated-index")

                with patch("app.netskope.sse.integrations.netskope.asyncio.sleep", new=AsyncMock()):
                    with self.assertRaises(NetskopeError) as raised:
                        asyncio.run(exercise())

                self.assertIn(f"HTTP {status_code}", str(raised.exception))
                self.assertIn("5 intentos", str(raised.exception))
                self.assertNotIn("sensitive response body", str(raised.exception))

    def test_incident_iterator_honors_successful_rate_limit_headers(self):
        responses = 0

        def handler(request):
            nonlocal responses
            responses += 1
            return httpx.Response(200, json={"result": []}, headers={
                "RateLimit-Remaining": "0", "RateLimit-Reset": "8",
            })

        settings = NetskopeSettings(**{
            **self.settings().__dict__, "dlp_incidents_path": "/api/v2/events/dataexport/events/incident",
        })

        async def exercise():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
                async with NetskopeClient(settings, http) as client:
                    await client.get_dlp_incident_page("next", "rate-test")
                    await client.get_dlp_incident_page("next", "rate-test")
                    self.assertEqual(client.request_count, 2)
                    self.assertEqual(client.retry_count, 0)

        with patch("app.netskope.sse.integrations.netskope.asyncio.sleep", new=AsyncMock()) as sleep:
            asyncio.run(exercise())
        self.assertEqual(responses, 2)
        sleep.assert_awaited_once()
        self.assertGreater(sleep.await_args.args[0], 7)
        self.assertLessEqual(sleep.await_args.args[0], 8)

    def test_incident_iterator_refuses_malformed_pages(self):
        settings = NetskopeSettings(**{
            **self.settings().__dict__, "dlp_incidents_path": "/api/v2/events/dataexport/events/incident",
        })

        async def exercise(payload):
            async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=payload))) as http:
                async with NetskopeClient(settings, http) as client:
                    with self.assertRaises(NetskopeError):
                        await client.get_dlp_incident_page("next", "shape-test")

        for payload in ({"result": "broken"}, {"result": [None]}, {"ok": 0, "result": []}, {}):
            with self.subTest(payload=payload):
                asyncio.run(exercise(payload))

    def test_dlp_incident_page_refuses_a_non_approved_route(self):
        settings = NetskopeSettings(**{
            **self.settings().__dict__,
            "dlp_incidents_path": "/api/v2/events/dataexport/alerts/content",
        })

        async def exercise():
            async with NetskopeClient(settings, httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200, json={})))) as netskope:
                await netskope.get_dlp_incident_page("next", "custodia-dlp-test")

        with self.assertRaises(NetskopeNotConfigured):
            asyncio.run(exercise())


class NetskopeMappingTests(unittest.TestCase):
    def test_dem_site_mapping_drops_location_networks_and_embedded_assets(self):
        site = {
            "id": "site:1", "name": "Site 1", "revision": "rev-1", "num_gateways": 1,
            "num_runners": 2, "date_create": "2026-02-19T09:58:02.601Z",
            "pop_tracing": {"gslb": True, "method": "icmp-paris", "period": 300, "tunnels": [{"kind": "ipsec"}]},
            "location": {"latitude": 40.7, "longitude": -73.9}, "city": "Secret city",
            "country": "US", "region": "Secret region", "subnets": ["10.0.0.0/24"],
            "gateways": [{"id": "gw:1", "name": "Gateway"}], "runners": [{"id": "runner:1", "name": "Runner"}],
            "unknown_field": "secret",
        }
        mapped = map_netskope_dem_sites([site])[0]
        self.assertEqual((mapped.source_system, mapped.object_type, mapped.source_id, mapped.display_name), ("netskope", "dem_site", "site:1", "Site 1"))
        self.assertEqual(mapped.attributes, {
            "revision": "rev-1", "date_create": "2026-02-19T09:58:02.601Z",
            "num_gateways": 1, "num_runners": 2,
            "pop_tracing": {"gslb": True, "method": "icmp-paris", "period": 300},
        })

    def test_dem_site_mapping_rejects_duplicate_identity(self):
        with self.assertRaises(ValueError):
            map_netskope_dem_sites([{"id": "site:1", "name": "One"}, {"id": "site:1", "name": "Two"}])

    def test_mapping_excludes_network_and_credential_adjacent_fields(self):
        objects = map_netskope_objects(
            [{"id": "u1", "givenName": "Ada", "familyName": "Lovelace", "emails": ["ada@example.com"], "accounts": []}],
            [{"device_id": "d1", "host_info": {"hostname": "laptop-1", "os": "Windows", "mac_addresses": "secret"}, "user_info": {"userkey": "u1", "username": "ada@example.com"}, "last_seen_device_event": {"event": "Connected"}}],
        )
        self.assertEqual({item.object_type for item in objects}, {"user", "device"})
        device = next(item for item in objects if item.object_type == "device")
        self.assertNotIn("mac_addresses", device.attributes)
        self.assertEqual(device.attributes["user_key"], "u1")
        self.assertEqual(device.attributes["company"], "EXAMPLE")
        user = next(item for item in objects if item.object_type == "user")
        self.assertEqual(user.attributes["company"], "EXAMPLE")

    def test_onprem_detection_is_kept_as_categories_and_never_as_addresses(self):
        # NSK-EXP-ONPREM-001
        device = {
            "device_id": "d1", "user_info": {"userkey": "u1", "username": "ada@example.com"}, "last_seen_device_event": {},
            "host_info": {"hostname": "laptop-1", "client_config": "Default tenant config", "steering_config": "Vmedia tenant config"},
            "onprem_status": {"status": "on-prem", "method": "Egress_IP", "match_ip": "203.0.113.7"},
            "onpremises_status": "on-prem", "last_connected_from_public_ip": "198.51.100.9", "last_connected_from_private_ip": "10.0.0.5",
            "netskope_pop": "AR-BUE1", "zipcode": "1234",
        }
        attributes = next(item for item in map_netskope_objects([], [device]) if item.object_type == "device").attributes
        self.assertEqual(
            {key: attributes[key] for key in ("onprem_status", "onprem_method", "client_config", "steering_config")},
            {"onprem_status": "on-prem", "onprem_method": "Egress_IP", "client_config": "Default tenant config", "steering_config": "Vmedia tenant config"},
        )
        rendered = repr(attributes)
        for secret in ("203.0.113.7", "198.51.100.9", "10.0.0.5", "AR-BUE1", "1234"):
            self.assertNotIn(secret, rendered)
        self.assertNotIn("match_ip", attributes)

    def test_onprem_detection_falls_back_and_stays_absent_when_not_reported(self):
        base = {"user_info": {}, "last_seen_device_event": {}, "host_info": {}}
        devices = [
            {**base, "device_id": "a", "onprem_status": "off-prem"},
            {**base, "device_id": "b", "onpremises_status": "unconfig"},
            {**base, "device_id": "c", "onprem_status": {"method": "HTTP"}},
            {**base, "device_id": "d", "onprem_status": {"status": "x" * 200}},
            {**base, "device_id": "e"},
        ]
        attributes = {item.source_id: item.attributes for item in map_netskope_objects([], devices) if item.object_type == "device"}
        self.assertEqual(attributes["a"]["onprem_status"], "off-prem")
        self.assertEqual(attributes["b"]["onprem_status"], "unconfig")
        self.assertNotIn("onprem_status", attributes["c"])
        self.assertEqual(attributes["c"]["onprem_method"], "HTTP")
        self.assertNotIn("onprem_status", attributes["d"])
        self.assertFalse({"onprem_status", "onprem_method", "client_config", "steering_config"} & set(attributes["e"]))

    def test_heartbeat_is_still_persisted_raw_even_though_no_surface_uses_it(self):
        # NSK-HB-001: the flag is kept as reported (snapshots read it from these attributes) so it can be
        # revisited later; only a real boolean is stored, anything else is "no data".
        devices = [{"device_id": f"d{index}", "heart_beat": value, "host_info": {}, "user_info": {}, "last_seen_device_event": {}}
                   for index, value in enumerate((True, False, "true", 1, None))]
        device_objects = [item for item in map_netskope_objects([], devices) if item.object_type == "device"]
        self.assertEqual([item.attributes["heartbeat"] for item in device_objects], [True, False, None, None, None])


if __name__ == "__main__":
    unittest.main()
