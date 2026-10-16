"""Regression coverage for the shared OAuth transport (integrations/oauth_client.py)."""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

import httpx

from app.cyberark.access.integrations.access import AccessClient, AccessError, AccessSettings
from app.cyberark.identity_administration.integrations.identity_admin import IdentityAdminClient, IdentityAdminError, IdentityAdminSettings
from app.cyberark.sia.integrations.sia import SiaClient, SiaError, SiaSettings


def identity_settings():
    return IdentityAdminSettings(
        base_url="https://identity.example", token_url="https://identity.example/oauth/token",
        client_id="client", client_secret="secret", users_path="/api/users", roles_path="/api/roles",
    )


def sia_settings():
    return SiaSettings(
        base_url="https://sia.example", token_url="https://sia.example/oauth/token",
        client_id="client", client_secret="secret", policies_path="/api/access-policies",
    )


def access_settings():
    return AccessSettings(
        base_url="https://tenant-userportal.example", token_url="https://tenant.example/oauth/token",
        client_id="client", client_secret="secret", assets_path="/api/assets",
    )


class SharedOAuthTransportTests(unittest.TestCase):
    def test_each_client_raises_its_own_error_type(self):
        cases = (
            (IdentityAdminClient, identity_settings(), IdentityAdminError, "/api/users"),
            (SiaClient, sia_settings(), SiaError, "/api/access-policies"),
            (AccessClient, access_settings(), AccessError, "/api/assets"),
        )
        for client_cls, settings, error_type, path in cases:
            with self.subTest(client=client_cls.__name__):
                http_client = httpx.AsyncClient(
                    transport=httpx.MockTransport(lambda request: httpx.Response(500, text="boom"))
                )

                async def exercise(client_cls=client_cls, settings=settings, http_client=http_client, path=path):
                    async with client_cls(settings, http_client) as client:
                        await client.get_json(path)

                with patch("app.cyberark.shared.integrations.oauth_client.asyncio.sleep", new=AsyncMock()):
                    with self.assertRaises(error_type):
                        asyncio.run(exercise())
                asyncio.run(http_client.aclose())

    def test_server_errors_are_retried_with_the_shared_backoff(self):
        responses = [
            httpx.Response(500, text="boom"),
            httpx.Response(200, json={"totalCount": 0, "items": []}),
        ]
        calls = {"get": 0}

        def handler(request):
            if request.method == "POST":
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            calls["get"] += 1
            return responses[calls["get"] - 1]

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        sleep = AsyncMock()

        async def exercise():
            async with SiaClient(sia_settings(), http_client) as client:
                return await client.get_policies()

        with patch("app.cyberark.shared.integrations.oauth_client.asyncio.sleep", new=sleep), patch(
            # BE-RETRY-001: pin full jitter to its upper bound so the shared
            # backoff assertion below stays deterministic.
            "app.cross.services.retry_backoff.random.random", return_value=1.0,
        ):
            policies = asyncio.run(exercise())
        asyncio.run(http_client.aclose())
        self.assertEqual(policies, [])
        self.assertEqual(calls["get"], 2)
        sleep.assert_awaited_once_with(1)

    def test_retry_after_is_respected_on_429(self):
        responses = [
            httpx.Response(429, headers={"Retry-After": "2.5"}, text="slow down"),
            httpx.Response(200, json={"totalCount": 0, "items": []}),
        ]
        calls = {"get": 0}

        def handler(request):
            if request.method == "POST":
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            calls["get"] += 1
            return responses[calls["get"] - 1]

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        sleep = AsyncMock()

        async def exercise():
            async with SiaClient(sia_settings(), http_client) as client:
                return await client.get_policies()

        with patch("app.cyberark.shared.integrations.oauth_client.asyncio.sleep", new=sleep):
            policies = asyncio.run(exercise())
        asyncio.run(http_client.aclose())
        self.assertEqual(policies, [])
        self.assertEqual(calls["get"], 2)
        sleep.assert_awaited_once_with(2.5)

    def test_retry_after_below_one_second_is_clamped_to_one(self):
        responses = [
            httpx.Response(429, headers={"Retry-After": "0.2"}, text="slow down"),
            httpx.Response(200, json={"totalCount": 0, "items": []}),
        ]
        calls = {"get": 0}

        def handler(request):
            if request.method == "POST":
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            calls["get"] += 1
            return responses[calls["get"] - 1]

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        sleep = AsyncMock()

        async def exercise():
            async with SiaClient(sia_settings(), http_client) as client:
                return await client.get_policies()

        with patch("app.cyberark.shared.integrations.oauth_client.asyncio.sleep", new=sleep):
            asyncio.run(exercise())
        asyncio.run(http_client.aclose())
        sleep.assert_awaited_once_with(1.0)

    def test_parallel_reads_share_one_oauth_request(self):
        token_calls = 0
        reads = []

        async def handler(request):
            nonlocal token_calls
            if request.method == "POST":
                token_calls += 1
                await asyncio.sleep(0.01)
                return httpx.Response(200, json={"access_token": "shared-token", "expires_in": 300})
            reads.append(request.headers["Authorization"])
            return httpx.Response(200, json={"ok": True})

        async def exercise():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
                async with SiaClient(sia_settings(), http) as client:
                    results = await asyncio.gather(*(client.get_json("/api/read") for _ in range(4)))
                    await client.get_json("/api/read")
                    return results

        self.assertEqual(asyncio.run(exercise()), [{"ok": True}] * 4)
        self.assertEqual(token_calls, 1)
        self.assertEqual(reads, ["Bearer shared-token"] * 5)

    def test_token_is_cached_across_requests(self):
        token_calls = 0

        def handler(request):
            nonlocal token_calls
            if request.method == "POST":
                token_calls += 1
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            return httpx.Response(200, json={"assets": [], "nextToken": None})

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with AccessClient(access_settings(), http_client) as client:
                await client.get_assets()
                await client.get_assets()

        asyncio.run(exercise())
        asyncio.run(http_client.aclose())
        self.assertEqual(token_calls, 1)

    def test_identity_requires_a_json_object(self):
        def handler(request):
            if request.method == "POST":
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            return httpx.Response(200, json=["not", "an", "object"])

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with IdentityAdminClient(identity_settings(), http_client) as client:
                return await client.get_json("/api/users")

        with self.assertRaises(IdentityAdminError):
            asyncio.run(exercise())
        asyncio.run(http_client.aclose())


if __name__ == "__main__":
    unittest.main()
