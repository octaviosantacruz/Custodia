import asyncio
import os
import unittest

import httpx
from unittest.mock import patch

from app.integrations.access import AccessClient, AccessError, AccessNotConfigured, AccessSettings


class AccessSettingsTests(unittest.TestCase):
    def test_requires_explicit_contract_variables(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(AccessNotConfigured):
                AccessSettings.from_environment()

    def test_reads_explicit_contract_variables(self):
        values = {
            "CA_ACCESS_URL": "https://tenant-userportal.example",
            "CA_ACCESS_TOKEN_URL": "https://tenant.example/oauth/token",
            "CA_ACCESS_CLIENT_ID": "client",
            "CA_ACCESS_CLIENT_SECRET": "secret",
            "CA_ACCESS_ASSETS_PATH": "/api/assets",
        }
        with patch.dict(os.environ, values, clear=True):
            settings = AccessSettings.from_environment()
        self.assertEqual(settings.assets_path, "/api/assets")


class AccessUrlTests(unittest.TestCase):
    def settings(self, base_url="https://tenant-userportal.example", token_url="https://tenant.example/oauth/token"):
        return AccessSettings(
            base_url=base_url, token_url=token_url, client_id="client",
            client_secret="secret", assets_path="/api/assets",
        )

    def test_rejects_non_https_configuration(self):
        with self.assertRaises(AccessNotConfigured):
            AccessClient(self.settings(base_url="http://tenant-userportal.example"))
        with self.assertRaises(AccessNotConfigured):
            AccessClient(self.settings(token_url="http://tenant.example/oauth/token"))

    def test_rejects_external_or_http_urls(self):
        client = AccessClient(self.settings())
        self.assertEqual(client._url_for("/api/assets"), "https://tenant-userportal.example/api/assets")
        with self.assertRaises(AccessError):
            client._url_for("https://evil.example/api/assets")
        with self.assertRaises(AccessError):
            client._url_for("http://tenant-userportal.example/api/assets")


class AccessHttpTests(unittest.TestCase):
    def settings(self):
        return AccessSettings(
            base_url="https://tenant-userportal.example", token_url="https://tenant.example/oauth/token",
            client_id="client", client_secret="secret", assets_path="/api/assets",
        )

    def test_get_assets_sends_bearer_token(self):
        calls = []

        def handler(request):
            calls.append(request)
            if request.method == "POST":
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            return httpx.Response(200, json={"assets": [{"assetId": "a1"}], "nextToken": None, "size": 1})

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with AccessClient(self.settings(), http_client) as client:
                return await client.get_assets()

        assets = asyncio.run(exercise())
        asyncio.run(http_client.aclose())
        self.assertEqual([a["assetId"] for a in assets], ["a1"])
        self.assertEqual(calls[0].method, "POST")
        self.assertEqual(calls[1].headers["authorization"], "Bearer token")

    def test_rejects_unconfirmed_pagination(self):
        def handler(request):
            if request.method == "POST":
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            return httpx.Response(200, json={"assets": [{"assetId": "a1"}], "nextToken": "cursor-2"})

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with AccessClient(self.settings(), http_client) as client:
                return await client.get_assets()

        with self.assertRaises(AccessError):
            asyncio.run(exercise())
        asyncio.run(http_client.aclose())

    def test_rejects_assets_payload_without_array(self):
        def handler(request):
            if request.method == "POST":
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            return httpx.Response(200, json={"assets": "not-a-list"})

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with AccessClient(self.settings(), http_client) as client:
                return await client.get_assets()

        with self.assertRaises(AccessError):
            asyncio.run(exercise())
        asyncio.run(http_client.aclose())

    def test_refreshes_token_once_after_401(self):
        token_calls = 0
        asset_calls = 0

        def handler(request):
            nonlocal token_calls, asset_calls
            if request.method == "POST":
                token_calls += 1
                return httpx.Response(200, json={"access_token": f"token-{token_calls}", "expires_in": 300})
            asset_calls += 1
            if asset_calls == 1:
                return httpx.Response(401, json={"error": "expired"})
            return httpx.Response(200, json={"assets": [], "nextToken": None})

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with AccessClient(self.settings(), http_client) as client:
                return await client.get_assets()

        assets = asyncio.run(exercise())
        asyncio.run(http_client.aclose())
        self.assertEqual(assets, [])
        self.assertEqual(token_calls, 2)
        self.assertEqual(asset_calls, 2)


if __name__ == "__main__":
    unittest.main()
