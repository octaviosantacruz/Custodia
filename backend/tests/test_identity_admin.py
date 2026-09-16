import asyncio
import os
import unittest

import httpx
from unittest.mock import patch

from app.integrations.identity_admin import IdentityAdminClient, IdentityAdminError, IdentityAdminNotConfigured, IdentityAdminSettings
from app.integrations.identity_admin_parsing import parse_collection_page


class IdentityAdminSettingsTests(unittest.TestCase):
    def test_requires_explicit_contract_variables(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(IdentityAdminNotConfigured):
                IdentityAdminSettings.from_environment()

    def test_reads_explicit_contract_variables(self):
        values = {
            "CA_IDENTITY_ADMIN_URL": "https://identity.example",
            "CA_IDENTITY_ADMIN_TOKEN_URL": "https://identity.example/oauth/token",
            "CA_IDENTITY_ADMIN_CLIENT_ID": "client",
            "CA_IDENTITY_ADMIN_CLIENT_SECRET": "secret",
            "CA_IDENTITY_ADMIN_USERS_PATH": "/api/users",
            "CA_IDENTITY_ADMIN_ROLES_PATH": "/api/roles",
        }
        with patch.dict(os.environ, values, clear=True):
            settings = IdentityAdminSettings.from_environment()
        self.assertEqual(settings.users_path, "/api/users")
        self.assertEqual(settings.roles_path, "/api/roles")

    def test_federations_path_is_optional_and_defaults_empty(self):
        """An install that only ever configured users/roles must keep working
        unchanged after ID-001 was added -- this path must never become part
        of the required contract."""
        values = {
            "CA_IDENTITY_ADMIN_URL": "https://identity.example",
            "CA_IDENTITY_ADMIN_TOKEN_URL": "https://identity.example/oauth/token",
            "CA_IDENTITY_ADMIN_CLIENT_ID": "client",
            "CA_IDENTITY_ADMIN_CLIENT_SECRET": "secret",
            "CA_IDENTITY_ADMIN_USERS_PATH": "/api/users",
            "CA_IDENTITY_ADMIN_ROLES_PATH": "/api/roles",
        }
        with patch.dict(os.environ, values, clear=True):
            settings = IdentityAdminSettings.from_environment()
        self.assertEqual(settings.federations_path, "")

    def test_reads_optional_federations_path_when_set(self):
        values = {
            "CA_IDENTITY_ADMIN_URL": "https://identity.example",
            "CA_IDENTITY_ADMIN_TOKEN_URL": "https://identity.example/oauth/token",
            "CA_IDENTITY_ADMIN_CLIENT_ID": "client",
            "CA_IDENTITY_ADMIN_CLIENT_SECRET": "secret",
            "CA_IDENTITY_ADMIN_USERS_PATH": "/api/users",
            "CA_IDENTITY_ADMIN_ROLES_PATH": "/api/roles",
            "CA_IDENTITY_ADMIN_FEDERATIONS_PATH": "/Federation/GetFederations",
        }
        with patch.dict(os.environ, values, clear=True):
            settings = IdentityAdminSettings.from_environment()
        self.assertEqual(settings.federations_path, "/Federation/GetFederations")


class IdentityAdminUrlTests(unittest.TestCase):
    def settings(self, base_url="https://identity.example", token_url="https://identity.example/oauth/token"):
        return IdentityAdminSettings(
            base_url=base_url, token_url=token_url, client_id="client",
            client_secret="secret", users_path="/api/users", roles_path="/api/roles",
        )

    def test_rejects_non_https_configuration(self):
        with self.assertRaises(IdentityAdminNotConfigured):
            IdentityAdminClient(self.settings(base_url="http://identity.example"))
        with self.assertRaises(IdentityAdminNotConfigured):
            IdentityAdminClient(self.settings(token_url="http://identity.example/oauth/token"))

    def test_rejects_external_or_http_next_links(self):
        client = IdentityAdminClient(self.settings())
        self.assertEqual(client._url_for("/api/users"), "https://identity.example/api/users")
        with self.assertRaises(IdentityAdminError):
            client._url_for("https://evil.example/api/users")
        with self.assertRaises(IdentityAdminError):
            client._url_for("http://identity.example/api/users")



class IdentityAdminHttpTests(unittest.TestCase):
    def settings(self, federations_path=""):
        return IdentityAdminSettings(
            base_url="https://identity.example", token_url="https://identity.example/oauth/token",
            client_id="client", client_secret="secret", users_path="/api/users", roles_path="/api/roles",
            federations_path=federations_path,
        )

    def test_paginates_collection_and_sends_bearer_token(self):
        calls = []

        def handler(request):
            calls.append(request)
            if request.method == "POST":
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            if "startIndex=3" in str(request.url):
                return httpx.Response(200, json={"totalResults": 3, "Resources": [{"id": "u3"}]})
            return httpx.Response(200, json={"totalResults": 3, "Resources": [{"id": "u1"}, {"id": "u2"}]})

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with IdentityAdminClient(self.settings(), http_client) as client:
                return await client.get_users(page_size=2)

        values, count = asyncio.run(exercise())
        asyncio.run(http_client.aclose())
        self.assertEqual([item["id"] for item in values], ["u1", "u2", "u3"])
        self.assertEqual(count, 3)
        self.assertEqual(calls[0].method, "POST")
        self.assertEqual(calls[1].headers["authorization"], "Bearer token")
        self.assertEqual(len(calls), 3)

    def test_collapses_repeated_ids_within_a_page(self):
        def handler(request):
            if request.method == "POST":
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            return httpx.Response(200, json={"totalResults": 1, "Resources": [
                {"id": "u1", "active": True},
                {"id": "u1", "active": False},
                {"id": "u2", "active": True},
            ]})

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with IdentityAdminClient(self.settings(), http_client) as client:
                return await client.get_users(page_size=100)

        values, _ = asyncio.run(exercise())
        asyncio.run(http_client.aclose())
        self.assertEqual([item["id"] for item in values], ["u1", "u2"])
        self.assertEqual(values[0]["active"], True)

    def test_refreshes_token_once_after_401(self):
        token_calls = 0
        user_calls = 0

        def handler(request):
            nonlocal token_calls, user_calls
            if request.method == "POST":
                token_calls += 1
                return httpx.Response(200, json={"access_token": f"token-{token_calls}", "expires_in": 300})
            user_calls += 1
            if user_calls == 1:
                return httpx.Response(401, json={"error": "expired"})
            return httpx.Response(200, json={"totalResults": 0, "Resources": []})

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with IdentityAdminClient(self.settings(), http_client) as client:
                return await client.get_users()

        values, count = asyncio.run(exercise())
        asyncio.run(http_client.aclose())
        self.assertEqual(values, [])
        self.assertEqual(count, 0)
        self.assertEqual(token_calls, 2)
        self.assertEqual(user_calls, 2)

    def test_rejects_malformed_collection_payload(self):
        def handler(request):
            if request.method == "POST":
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            return httpx.Response(200, json={"totalResults": 2, "Resources": "not-a-list"})

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with IdentityAdminClient(self.settings(), http_client) as client:
                return await client.get_users()

        with self.assertRaises(IdentityAdminError):
            asyncio.run(exercise())
        asyncio.run(http_client.aclose())


class IdentityAdminFederationsTests(unittest.TestCase):
    def settings(self, federations_path=""):
        return IdentityAdminSettings(
            base_url="https://identity.example", token_url="https://identity.example/oauth/token",
            client_id="client", client_secret="secret", users_path="/api/users", roles_path="/api/roles",
            federations_path=federations_path,
        )

    def test_raises_when_path_not_configured(self):
        async def exercise():
            async with IdentityAdminClient(self.settings()) as client:
                return await client.get_federations()

        with self.assertRaises(IdentityAdminNotConfigured):
            asyncio.run(exercise())

    def test_returns_result_items(self):
        def handler(request):
            if request.method == "POST":
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            return httpx.Response(200, json={"success": True, "ErrorCode": None, "Result": [{"FederationUuid": "f1"}]})

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with IdentityAdminClient(self.settings(federations_path="/Federation/GetFederations"), http_client) as client:
                return await client.get_federations()

        federations = asyncio.run(exercise())
        asyncio.run(http_client.aclose())
        self.assertEqual([f["FederationUuid"] for f in federations], ["f1"])

    def test_raises_on_reported_api_error(self):
        def handler(request):
            if request.method == "POST":
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            return httpx.Response(200, json={"success": False, "ErrorCode": "SomeError", "Result": None})

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with IdentityAdminClient(self.settings(federations_path="/Federation/GetFederations"), http_client) as client:
                return await client.get_federations()

        with self.assertRaises(IdentityAdminError):
            asyncio.run(exercise())
        asyncio.run(http_client.aclose())

    def test_rejects_malformed_result(self):
        def handler(request):
            if request.method == "POST":
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            return httpx.Response(200, json={"success": True, "Result": "not-a-list"})

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with IdentityAdminClient(self.settings(federations_path="/Federation/GetFederations"), http_client) as client:
                return await client.get_federations()

        with self.assertRaises(IdentityAdminError):
            asyncio.run(exercise())
        asyncio.run(http_client.aclose())


class IdentityAdminParsingTests(unittest.TestCase):
    def test_parses_scim_list_response(self):
        page, total = parse_collection_page({"Resources": [{"id": "u1"}], "totalResults": 2})
        self.assertEqual(page, [{"id": "u1"}])
        self.assertEqual(total, 2)

    def test_defaults_to_empty_resources(self):
        page, total = parse_collection_page({"totalResults": 0})
        self.assertEqual(page, [])
        self.assertEqual(total, 0)

    def test_rejects_invalid_total_results(self):
        with self.assertRaises(ValueError):
            parse_collection_page({"Resources": [], "totalResults": "invalid"})


if __name__ == "__main__":
    unittest.main()
