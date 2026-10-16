import asyncio
import os
import unittest
from unittest.mock import AsyncMock, patch

import httpx

from app.cyberark.pam.client import CyberArkClient, CyberArkSettings
from app.cyberark.pam.cyberark_errors import CyberArkError
from app.cyberark.pam.services.cyberark_transport import CyberArkTransport


class CyberArkClientTests(unittest.TestCase):
    def test_rejects_non_https_configuration(self):
        with patch.dict(os.environ, {
            "CA_IDENTITY_URL": "http://identity.test",
            "CA_PVWA_URL": "https://vault.test",
            "CA_CLIENT_ID": "client",
            "CA_CLIENT_SECRET": "secret",
        }, clear=False), self.assertRaisesRegex(CyberArkError, "HTTPS"):
            CyberArkSettings.from_environment()

    def test_rejects_http_next_link_even_on_allowed_host(self):
        settings = CyberArkSettings("https://identity.test", "https://vault.test/PasswordVault", "client", "secret")
        with self.assertRaises(CyberArkError):
            CyberArkTransport(settings)._url_for("http://vault.test/PasswordVault/API/Safes?page=2")

    def test_paginates_and_checks_count(self):
        calls = []

        def handler(request: httpx.Request) -> httpx.Response:
            calls.append((request.method, str(request.url)))
            if request.method == "POST":
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            if "offset=2" in str(request.url):
                return httpx.Response(200, json={"count": 3, "value": [{"safeName": "C"}], "nextLink": None})
            return httpx.Response(200, json={"count": 3, "value": [{"safeName": "A"}, {"safeName": "B"}], "nextLink": "/API/Safes?offset=2"})

        settings = CyberArkSettings("https://identity.test", "https://vault.test/PasswordVault", "client", "secret")
        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with CyberArkClient(settings, http_client) as client:
                values, count = await client.get_safes(page_size=2)
            await http_client.aclose()
            return values, count

        values, count = asyncio.run(exercise())
        self.assertEqual([item["safeName"] for item in values], ["A", "B", "C"])
        self.assertEqual(count, 3)
        self.assertEqual(calls[0][0], "POST")
        self.assertEqual(len(calls), 3)

    def test_refreshes_once_after_401(self):
        token_calls = 0
        safe_calls = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal token_calls, safe_calls
            if request.method == "POST":
                token_calls += 1
                return httpx.Response(200, json={"access_token": f"token-{token_calls}", "expires_in": 300})
            safe_calls += 1
            if safe_calls == 1:
                return httpx.Response(401, json={"error": "expired"})
            return httpx.Response(200, json={"value": [], "count": 0})

        settings = CyberArkSettings("https://identity.test", "https://vault.test/PasswordVault", "client", "secret")
        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with CyberArkClient(settings, http_client) as client:
                return await client.get_json("/API/Safes")

        payload = asyncio.run(exercise())
        asyncio.run(http_client.aclose())
        self.assertEqual(payload["count"], 0)
        self.assertEqual(token_calls, 2)
        self.assertEqual(safe_calls, 2)

    def test_retries_429_with_retry_after(self):
        safe_calls = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal safe_calls
            if request.method == "POST":
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            safe_calls += 1
            if safe_calls == 1:
                return httpx.Response(429, headers={"Retry-After": "2.5"}, text="slow down")
            return httpx.Response(200, json={"value": [], "count": 0})

        settings = CyberArkSettings("https://identity.test", "https://vault.test/PasswordVault", "client", "secret")
        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        sleep = AsyncMock()

        async def exercise():
            async with CyberArkClient(settings, http_client) as client:
                return await client.get_json("/API/Safes")

        with patch("app.cyberark.pam.services.cyberark_transport.asyncio.sleep", new=sleep):
            payload = asyncio.run(exercise())
        asyncio.run(http_client.aclose())
        self.assertEqual(payload["count"], 0)
        self.assertEqual(safe_calls, 2)
        sleep.assert_awaited_once_with(2.5)


def _token_response() -> httpx.Response:
    return httpx.Response(200, json={"access_token": "token", "expires_in": 300})


class CyberArkTechnicalCatalogClientTests(unittest.TestCase):
    """PSM-001, PLAT-002/003, SYS-001, PAM-USR-001 (ExtendedDetails)."""

    def _run(self, handler):
        settings = CyberArkSettings("https://identity.test", "https://vault.test/PasswordVault", "client", "secret")
        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise(method_name: str, *args):
            async with CyberArkClient(settings, http_client) as client:
                return await getattr(client, method_name)(*args)

        return exercise, http_client

    def test_get_users_requests_extended_details(self):
        requested_urls = []

        def handler(request: httpx.Request) -> httpx.Response:
            if request.method == "POST":
                return _token_response()
            requested_urls.append(str(request.url))
            return httpx.Response(200, json={"Users": [], "Total": 0})

        exercise, http_client = self._run(handler)
        asyncio.run(exercise("get_users"))
        asyncio.run(http_client.aclose())
        self.assertTrue(any("ExtendedDetails=true" in url for url in requested_urls))

    def test_get_platform_targets_parses_platforms_and_total(self):
        def handler(request: httpx.Request) -> httpx.Response:
            if request.method == "POST":
                return _token_response()
            return httpx.Response(200, json={"Platforms": [{"ID": 1, "Name": "A"}], "Total": 1})

        exercise, http_client = self._run(handler)
        values, count = asyncio.run(exercise("get_platform_targets"))
        asyncio.run(http_client.aclose())
        self.assertEqual(values, [{"ID": 1, "Name": "A"}])
        self.assertEqual(count, 1)

    def test_get_platform_targets_rejects_incomplete_pagination(self):
        def handler(request: httpx.Request) -> httpx.Response:
            if request.method == "POST":
                return _token_response()
            return httpx.Response(200, json={"Platforms": [{"ID": 1}], "Total": 5})

        exercise, http_client = self._run(handler)
        with self.assertRaises(CyberArkError):
            asyncio.run(exercise("get_platform_targets"))
        asyncio.run(http_client.aclose())

    def test_get_platform_dependents_parses_platforms_and_total(self):
        def handler(request: httpx.Request) -> httpx.Response:
            if request.method == "POST":
                return _token_response()
            return httpx.Response(200, json={"Platforms": [{"ID": 1, "Name": "Dep"}], "Total": 1})

        exercise, http_client = self._run(handler)
        values, count = asyncio.run(exercise("get_platform_dependents"))
        asyncio.run(http_client.aclose())
        self.assertEqual(values[0]["Name"], "Dep")
        self.assertEqual(count, 1)

    def test_get_platform_groups_parses_platforms_and_total(self):
        def handler(request: httpx.Request) -> httpx.Response:
            if request.method == "POST":
                return _token_response()
            return httpx.Response(200, json={"Platforms": [{"ID": 2, "Name": "Group"}], "Total": 1})

        exercise, http_client = self._run(handler)
        values, count = asyncio.run(exercise("get_platform_groups"))
        asyncio.run(http_client.aclose())
        self.assertEqual(values[0]["Name"], "Group")
        self.assertEqual(count, 1)

    def test_get_platform_rotational_groups_parses_platforms_and_total(self):
        def handler(request: httpx.Request) -> httpx.Response:
            if request.method == "POST":
                return _token_response()
            return httpx.Response(200, json={"Platforms": [], "Total": 0})

        exercise, http_client = self._run(handler)
        values, count = asyncio.run(exercise("get_platform_rotational_groups"))
        asyncio.run(http_client.aclose())
        self.assertEqual(values, [])
        self.assertEqual(count, 0)

    def test_get_psm_servers_parses_psm_servers_and_total(self):
        def handler(request: httpx.Request) -> httpx.Response:
            if request.method == "POST":
                return _token_response()
            return httpx.Response(200, json={"PSMServers": [{"ID": "PSMServer_01", "Name": "n", "Address": "10.0.0.1"}], "Total": 1})

        exercise, http_client = self._run(handler)
        values, count = asyncio.run(exercise("get_psm_servers"))
        asyncio.run(http_client.aclose())
        self.assertEqual(values[0]["Address"], "10.0.0.1")
        self.assertEqual(count, 1)

    def test_get_psm_connectors_parses_psm_connectors_and_total(self):
        def handler(request: httpx.Request) -> httpx.Response:
            if request.method == "POST":
                return _token_response()
            return httpx.Response(200, json={"PSMConnectors": [{"ID": "PSM-RDP", "DisplayName": ""}], "Total": 1})

        exercise, http_client = self._run(handler)
        values, count = asyncio.run(exercise("get_psm_connectors"))
        asyncio.run(http_client.aclose())
        self.assertEqual(values[0]["ID"], "PSM-RDP")
        self.assertEqual(count, 1)

    def test_get_components_summary_validates_components_list(self):
        def handler(request: httpx.Request) -> httpx.Response:
            if request.method == "POST":
                return _token_response()
            return httpx.Response(200, json={"Components": [{"ComponentID": "PVWA"}], "Vaults": []})

        exercise, http_client = self._run(handler)
        payload = asyncio.run(exercise("get_components_summary"))
        asyncio.run(http_client.aclose())
        self.assertEqual(payload["Components"][0]["ComponentID"], "PVWA")

    def test_get_components_summary_rejects_invalid_shape(self):
        def handler(request: httpx.Request) -> httpx.Response:
            if request.method == "POST":
                return _token_response()
            return httpx.Response(200, json={"Vaults": []})

        exercise, http_client = self._run(handler)
        with self.assertRaises(CyberArkError):
            asyncio.run(exercise("get_components_summary"))
        asyncio.run(http_client.aclose())

    def test_get_component_detail_parses_components_details(self):
        def handler(request: httpx.Request) -> httpx.Response:
            if request.method == "POST":
                return _token_response()
            return httpx.Response(200, json={"ComponentsDetails": [{"ComponentVersion": "14.2", "IsLoggedOn": True, "LastLogonDate": 1725900000}]})

        exercise, http_client = self._run(handler)
        details = asyncio.run(exercise("get_component_detail", "PVWA"))
        asyncio.run(http_client.aclose())
        self.assertEqual(details[0]["ComponentVersion"], "14.2")

    def test_get_component_detail_rejects_invalid_shape(self):
        def handler(request: httpx.Request) -> httpx.Response:
            if request.method == "POST":
                return _token_response()
            return httpx.Response(200, json={"unexpected": True})

        exercise, http_client = self._run(handler)
        with self.assertRaises(CyberArkError):
            asyncio.run(exercise("get_component_detail", "PVWA"))
        asyncio.run(http_client.aclose())

if __name__ == "__main__":
    unittest.main()
