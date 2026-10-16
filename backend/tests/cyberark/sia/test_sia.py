import asyncio
import os
import unittest

import httpx
from unittest.mock import patch

from app.cyberark.sia.integrations.sia import SiaClient, SiaError, SiaNotConfigured, SiaSettings


class SiaSettingsTests(unittest.TestCase):
    def test_requires_explicit_contract_variables(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(SiaNotConfigured):
                SiaSettings.from_environment()

    def test_reads_explicit_contract_variables(self):
        values = {
            "CA_SIA_URL": "https://sia.example",
            "CA_SIA_TOKEN_URL": "https://sia.example/oauth/token",
            "CA_SIA_CLIENT_ID": "client",
            "CA_SIA_CLIENT_SECRET": "secret",
            "CA_SIA_POLICIES_PATH": "/api/access-policies",
        }
        with patch.dict(os.environ, values, clear=True):
            settings = SiaSettings.from_environment()
        self.assertEqual(settings.policies_path, "/api/access-policies")

    def test_connectors_and_vm_paths_are_optional_and_default_empty(self):
        """An install that only ever configured policies must keep working
        unchanged after SIA-CONN-001/SIA-RES-001 were added -- these two
        paths must never become part of the required contract."""
        values = {
            "CA_SIA_URL": "https://sia.example",
            "CA_SIA_TOKEN_URL": "https://sia.example/oauth/token",
            "CA_SIA_CLIENT_ID": "client",
            "CA_SIA_CLIENT_SECRET": "secret",
            "CA_SIA_POLICIES_PATH": "/api/access-policies",
        }
        with patch.dict(os.environ, values, clear=True):
            settings = SiaSettings.from_environment()
        self.assertEqual(settings.connectors_path, "")
        self.assertEqual(settings.vm_infrastructure_path, "")
        self.assertEqual(settings.target_sets_path, "")

    def test_reads_optional_connectors_and_vm_paths_when_set(self):
        values = {
            "CA_SIA_URL": "https://sia.example",
            "CA_SIA_TOKEN_URL": "https://sia.example/oauth/token",
            "CA_SIA_CLIENT_ID": "client",
            "CA_SIA_CLIENT_SECRET": "secret",
            "CA_SIA_POLICIES_PATH": "/api/access-policies",
            "CA_SIA_CONNECTORS_PATH": "/api/connectors",
            "CA_SIA_VM_INFRASTRUCTURE_PATH": "/api/infrastructure/virtual-machines",
        }
        with patch.dict(os.environ, values, clear=True):
            settings = SiaSettings.from_environment()
        self.assertEqual(settings.connectors_path, "/api/connectors")
        self.assertEqual(settings.vm_infrastructure_path, "/api/infrastructure/virtual-machines")

    def test_reads_optional_target_sets_path_when_set(self):
        values = {
            "CA_SIA_URL": "https://sia.example",
            "CA_SIA_TOKEN_URL": "https://sia.example/oauth/token",
            "CA_SIA_CLIENT_ID": "client",
            "CA_SIA_CLIENT_SECRET": "secret",
            "CA_SIA_POLICIES_PATH": "/api/access-policies",
            "CA_SIA_TARGET_SETS_PATH": "/api/targetsets",
        }
        with patch.dict(os.environ, values, clear=True):
            settings = SiaSettings.from_environment()
        self.assertEqual(settings.target_sets_path, "/api/targetsets")


class SiaUrlTests(unittest.TestCase):
    def settings(self, base_url="https://sia.example", token_url="https://sia.example/oauth/token"):
        return SiaSettings(
            base_url=base_url, token_url=token_url, client_id="client",
            client_secret="secret", policies_path="/api/access-policies",
        )

    def test_rejects_non_https_configuration(self):
        with self.assertRaises(SiaNotConfigured):
            SiaClient(self.settings(base_url="http://sia.example"))
        with self.assertRaises(SiaNotConfigured):
            SiaClient(self.settings(token_url="http://sia.example/oauth/token"))

    def test_rejects_external_or_http_urls(self):
        client = SiaClient(self.settings())
        self.assertEqual(client._url_for("/api/access-policies"), "https://sia.example/api/access-policies")
        with self.assertRaises(SiaError):
            client._url_for("https://evil.example/api/access-policies")
        with self.assertRaises(SiaError):
            client._url_for("http://sia.example/api/access-policies")


class SiaHttpTests(unittest.TestCase):
    def settings(self, connectors_path="", vm_infrastructure_path="", db_strong_accounts_path="", target_sets_path=""):
        return SiaSettings(
            base_url="https://sia.example", token_url="https://sia.example/oauth/token",
            client_id="client", client_secret="secret", policies_path="/api/access-policies",
            connectors_path=connectors_path, vm_infrastructure_path=vm_infrastructure_path,
            db_strong_accounts_path=db_strong_accounts_path, target_sets_path=target_sets_path,
        )

    def test_get_policies_sends_bearer_token(self):
        calls = []

        def handler(request):
            calls.append(request)
            if request.method == "POST":
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            return httpx.Response(200, json={"totalCount": 1, "items": [{"policyId": "p1", "policyName": "Policy 1"}]})

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with SiaClient(self.settings(), http_client) as client:
                return await client.get_policies()

        policies = asyncio.run(exercise())
        asyncio.run(http_client.aclose())
        self.assertEqual([p["policyId"] for p in policies], ["p1"])
        self.assertEqual(calls[0].method, "POST")
        self.assertEqual(calls[1].headers["authorization"], "Bearer token")

    def test_paginates_across_multiple_pages_using_limit_and_offset(self):
        requested_urls = []
        pages = [
            {"totalCount": 5, "items": [{"policyId": f"p{i}"} for i in range(1, 3)]},
            {"totalCount": 5, "items": [{"policyId": f"p{i}"} for i in range(3, 5)]},
            {"totalCount": 5, "items": [{"policyId": "p5"}]},
        ]

        def handler(request):
            if request.method == "POST":
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            requested_urls.append(str(request.url))
            return httpx.Response(200, json=pages[len(requested_urls) - 1])

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with SiaClient(self.settings(), http_client) as client:
                return await client.get_policies()

        policies = asyncio.run(exercise())
        asyncio.run(http_client.aclose())
        self.assertEqual([p["policyId"] for p in policies], ["p1", "p2", "p3", "p4", "p5"])
        self.assertEqual(
            requested_urls,
            [
                "https://sia.example/api/access-policies?limit=100&offset=0",
                "https://sia.example/api/access-policies?limit=100&offset=2",
                "https://sia.example/api/access-policies?limit=100&offset=4",
            ],
        )

    def test_stops_pagination_on_a_short_page_without_total_count(self):
        requested_urls = []

        def handler(request):
            if request.method == "POST":
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            requested_urls.append(str(request.url))
            return httpx.Response(200, json={"items": [{"policyId": "p1"}]})

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with SiaClient(self.settings(), http_client) as client:
                return await client.get_policies()

        policies = asyncio.run(exercise())
        asyncio.run(http_client.aclose())
        self.assertEqual([p["policyId"] for p in policies], ["p1"])
        self.assertEqual(len(requested_urls), 1)

    def test_rejects_inconsistent_total_count_between_pages(self):
        pages = [
            {"totalCount": 5, "items": [{"policyId": f"p{i}"} for i in range(1, 3)]},
            {"totalCount": 9, "items": [{"policyId": f"p{i}"} for i in range(3, 5)]},
        ]
        calls = {"n": 0}

        def handler(request):
            if request.method == "POST":
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            payload = pages[calls["n"]]
            calls["n"] += 1
            return httpx.Response(200, json=payload)

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with SiaClient(self.settings(), http_client) as client:
                return await client.get_policies()

        with self.assertRaises(SiaError):
            asyncio.run(exercise())
        asyncio.run(http_client.aclose())

    def test_rejects_an_empty_page_before_total_count_is_reached(self):
        pages = [
            {"totalCount": 5, "items": [{"policyId": "p1"}]},
            {"totalCount": 5, "items": []},
        ]
        calls = {"n": 0}

        def handler(request):
            if request.method == "POST":
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            payload = pages[calls["n"]]
            calls["n"] += 1
            return httpx.Response(200, json=payload)

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with SiaClient(self.settings(), http_client) as client:
                return await client.get_policies()

        with self.assertRaises(SiaError):
            asyncio.run(exercise())
        asyncio.run(http_client.aclose())

    def test_refreshes_token_once_after_401(self):
        token_calls = 0
        policy_calls = 0

        def handler(request):
            nonlocal token_calls, policy_calls
            if request.method == "POST":
                token_calls += 1
                return httpx.Response(200, json={"access_token": f"token-{token_calls}", "expires_in": 300})
            policy_calls += 1
            if policy_calls == 1:
                return httpx.Response(401, json={"error": "expired"})
            return httpx.Response(200, json={"totalCount": 0, "items": []})

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with SiaClient(self.settings(), http_client) as client:
                return await client.get_policies()

        policies = asyncio.run(exercise())
        asyncio.run(http_client.aclose())
        self.assertEqual(policies, [])
        self.assertEqual(token_calls, 2)
        self.assertEqual(policy_calls, 2)

    def test_get_policy_detail_builds_child_path(self):
        requested_urls = []

        def handler(request):
            if request.method == "POST":
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            requested_urls.append(str(request.url))
            return httpx.Response(200, json={"policyId": "p1", "userAccessRules": []})

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with SiaClient(self.settings(), http_client) as client:
                return await client.get_policy_detail("p1")

        detail = asyncio.run(exercise())
        asyncio.run(http_client.aclose())
        self.assertEqual(detail["policyId"], "p1")
        self.assertEqual(requested_urls, ["https://sia.example/api/access-policies/p1"])

    def test_get_connectors_raises_when_path_not_configured(self):
        async def exercise():
            async with SiaClient(self.settings()) as client:
                return await client.get_connectors()

        with self.assertRaises(SiaNotConfigured):
            asyncio.run(exercise())

    def test_get_connectors_returns_items(self):
        def handler(request):
            if request.method == "POST":
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            return httpx.Response(200, json={"continuationToken": None, "count": 1, "items": [{"id": "c1"}]})

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with SiaClient(self.settings(connectors_path="/api/connectors"), http_client) as client:
                return await client.get_connectors()

        connectors = asyncio.run(exercise())
        asyncio.run(http_client.aclose())
        self.assertEqual([c["id"] for c in connectors], ["c1"])

    def test_get_connectors_rejects_a_short_page_against_its_own_count(self):
        def handler(request):
            if request.method == "POST":
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            return httpx.Response(200, json={"continuationToken": "cursor-2", "count": 5, "items": [{"id": "c1"}]})

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with SiaClient(self.settings(connectors_path="/api/connectors"), http_client) as client:
                return await client.get_connectors()

        with self.assertRaises(SiaError):
            asyncio.run(exercise())
        asyncio.run(http_client.aclose())

    def test_get_connectors_accepts_a_truthy_token_when_count_is_already_satisfied(self):
        """A non-empty continuationToken alone must not fail the call: the
        tenant was observed returning a truthy cursor even when count already
        matches the full collection (same behavior confirmed for VMs)."""
        def handler(request):
            if request.method == "POST":
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            return httpx.Response(200, json={"continuationToken": "cursor-but-nothing-more", "count": 1, "items": [{"id": "c1"}]})

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with SiaClient(self.settings(connectors_path="/api/connectors"), http_client) as client:
                return await client.get_connectors()

        connectors = asyncio.run(exercise())
        asyncio.run(http_client.aclose())
        self.assertEqual([c["id"] for c in connectors], ["c1"])

    def test_get_virtual_machines_raises_when_path_not_configured(self):
        async def exercise():
            async with SiaClient(self.settings()) as client:
                return await client.get_virtual_machines()

        with self.assertRaises(SiaNotConfigured):
            asyncio.run(exercise())

    def test_get_virtual_machines_returns_items(self):
        def handler(request):
            if request.method == "POST":
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            return httpx.Response(200, json={"items": [{"machineId": "vm1"}], "nextToken": None, "totalCount": 1})

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with SiaClient(self.settings(vm_infrastructure_path="/api/infrastructure/virtual-machines"), http_client) as client:
                return await client.get_virtual_machines()

        machines = asyncio.run(exercise())
        asyncio.run(http_client.aclose())
        self.assertEqual([m["machineId"] for m in machines], ["vm1"])

    def test_get_virtual_machines_rejects_a_short_page_against_total_count(self):
        def handler(request):
            if request.method == "POST":
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            return httpx.Response(200, json={"items": [{"machineId": "vm1"}], "nextToken": "cursor-2", "totalCount": 5})

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with SiaClient(self.settings(vm_infrastructure_path="/api/infrastructure/virtual-machines"), http_client) as client:
                return await client.get_virtual_machines()

        with self.assertRaises(SiaError):
            asyncio.run(exercise())
        asyncio.run(http_client.aclose())

    def test_get_virtual_machines_accepts_a_truthy_token_when_total_count_is_already_satisfied(self):
        """Reproduces the real tenant behavior confirmed 2026-09-11: 28 items,
        totalCount=28, nextToken still truthy. Must not fail."""
        def handler(request):
            if request.method == "POST":
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            return httpx.Response(200, json={"items": [{"machineId": "vm1"}], "nextToken": "still-present", "totalCount": 1})

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with SiaClient(self.settings(vm_infrastructure_path="/api/infrastructure/virtual-machines"), http_client) as client:
                return await client.get_virtual_machines()

        machines = asyncio.run(exercise())
        asyncio.run(http_client.aclose())
        self.assertEqual([m["machineId"] for m in machines], ["vm1"])

    def test_get_database_strong_accounts_raises_when_path_not_configured(self):
        async def exercise():
            async with SiaClient(self.settings()) as client:
                return await client.get_database_strong_accounts()

        with self.assertRaises(SiaNotConfigured):
            asyncio.run(exercise())

    def test_get_database_strong_accounts_returns_items(self):
        def handler(request):
            if request.method == "POST":
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            return httpx.Response(200, json={"items": [{"id": "db1"}], "nextCursor": None, "totalCount": 1})

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with SiaClient(self.settings(db_strong_accounts_path="/api/database-strong-accounts"), http_client) as client:
                return await client.get_database_strong_accounts()

        accounts = asyncio.run(exercise())
        asyncio.run(http_client.aclose())
        self.assertEqual([a["id"] for a in accounts], ["db1"])

    def test_get_database_strong_accounts_rejects_a_short_page_against_total_count(self):
        def handler(request):
            if request.method == "POST":
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            return httpx.Response(200, json={"items": [{"id": "db1"}], "nextCursor": "cursor-2", "totalCount": 5})

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with SiaClient(self.settings(db_strong_accounts_path="/api/database-strong-accounts"), http_client) as client:
                return await client.get_database_strong_accounts()

        with self.assertRaises(SiaError):
            asyncio.run(exercise())
        asyncio.run(http_client.aclose())

    def test_get_database_strong_accounts_accepts_a_truthy_cursor_when_total_count_is_already_satisfied(self):
        def handler(request):
            if request.method == "POST":
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            return httpx.Response(200, json={"items": [{"id": "db1"}], "nextCursor": "still-present", "totalCount": 1})

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with SiaClient(self.settings(db_strong_accounts_path="/api/database-strong-accounts"), http_client) as client:
                return await client.get_database_strong_accounts()

        accounts = asyncio.run(exercise())
        asyncio.run(http_client.aclose())
        self.assertEqual([a["id"] for a in accounts], ["db1"])

    def test_get_target_sets_paginates_using_the_sdk_cursor_and_query_separator(self):
        requested_urls = []
        pages = [
            {"target_sets": [{"name": "set-1"}], "b64_last_evaluated_key": "cursor+/="},
            {"target_sets": [{"name": "set-2"}]},
        ]

        def handler(request):
            if request.method == "POST":
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            requested_urls.append(str(request.url))
            return httpx.Response(200, json=pages[len(requested_urls) - 1])

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with SiaClient(self.settings(target_sets_path="/api/targetsets?region=one"), http_client) as client:
                return await client.get_target_sets()

        target_sets = asyncio.run(exercise())
        asyncio.run(http_client.aclose())
        self.assertEqual([item["name"] for item in target_sets], ["set-1", "set-2"])
        self.assertEqual(len(requested_urls), 2)
        self.assertEqual(httpx.URL(requested_urls[0]).params["region"], "one")
        second_query = httpx.URL(requested_urls[1]).params
        self.assertEqual(second_query["region"], "one")
        self.assertEqual(second_query["b64_last_evaluated_key"], "cursor+/=")

    def test_get_target_sets_rejects_repeated_cursor(self):
        requests = 0

        def handler(request):
            nonlocal requests
            if request.method == "POST":
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            requests += 1
            return httpx.Response(200, json={
                "target_sets": [{"name": f"set-{requests}"}],
                "b64_last_evaluated_key": "same-cursor",
            })

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with SiaClient(self.settings(target_sets_path="/api/targetsets"), http_client) as client:
                await client.get_target_sets()

        with self.assertRaisesRegex(SiaError, "repitió un cursor"):
            asyncio.run(exercise())
        asyncio.run(http_client.aclose())
        self.assertEqual(requests, 2)

    def test_get_target_sets_rejects_unexpected_shape(self):
        def handler(request):
            if request.method == "POST":
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            return httpx.Response(200, json={"items": [{"name": "not-the-assumed-key"}]})

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with SiaClient(self.settings(target_sets_path="/api/targetsets"), http_client) as client:
                await client.get_target_sets()

        with self.assertRaisesRegex(SiaError, "no contiene target_sets"):
            asyncio.run(exercise())
        asyncio.run(http_client.aclose())

    def test_get_target_sets_raises_when_path_not_configured(self):
        async def exercise():
            async with SiaClient(self.settings()) as client:
                return await client.get_target_sets()

        with self.assertRaises(SiaNotConfigured):
            asyncio.run(exercise())

    def test_get_target_sets_fails_at_the_item_safety_limit(self):
        def handler(request):
            if request.method == "POST":
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            return httpx.Response(200, json={"target_sets": [{"name": "one"}, {"name": "two"}]})

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with SiaClient(self.settings(target_sets_path="/api/targetsets"), http_client) as client:
                return await client.get_target_sets()

        with patch.object(SiaClient, "_POLICIES_MAX_ITEMS", 1):
            with self.assertRaisesRegex(SiaError, "límite de seguridad de elementos"):
                asyncio.run(exercise())
        asyncio.run(http_client.aclose())


if __name__ == "__main__":
    unittest.main()
