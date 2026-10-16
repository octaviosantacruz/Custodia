"""CHAIN-010: the person routes' gate and permission-driven source visibility."""

import unittest
from contextlib import ExitStack
from unittest.mock import AsyncMock, patch

import httpx

from tests.cross.test_permission_http_matrix import _AuthenticatedSession, app


class PersonRoutesHttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")
        self.addAsyncCleanup(self.client.aclose)
        self.session = _AuthenticatedSession(self.stack, self.client)
        await self.session.login()

    async def test_sia_permission_alone_is_rejected(self):
        self.session.set_permissions(["sia:catalogs_read"])
        summary = await self.client.get("/api/chains/person", params={"email": "ada@example.com"})
        search = await self.client.get("/api/chains/person/search", params={"q": "ada"})
        self.assertEqual(summary.status_code, 403)
        self.assertEqual(search.status_code, 403)

    async def test_each_permission_maps_to_its_own_sources(self):
        cases = [
            (["netskope:read"], {"netskope"}),
            (["identity:catalogs_read"], {"identity"}),
            (["pam:catalogs_read"], {"pam"}),
            (["pam:catalogs_read", "sia:catalogs_read"], {"pam", "sia"}),
            (["access:manage"], {"pam", "identity", "netskope", "sia"}),
        ]
        for permissions, expected in cases:
            with self.subTest(permissions=permissions):
                self.session.set_permissions(permissions)
                search = AsyncMock(return_value={"query": "ada", "people": []})
                summary = AsyncMock(return_value={"email": "ada@example.com", "name": "", "tools": {}})
                with patch("app.cross.api.routes.chains_person.get_actor_permissions", new=AsyncMock(return_value=permissions)), \
                     patch("app.cross.api.routes.chains_person.search_person_candidates", new=search), \
                     patch("app.cross.api.routes.chains_person.get_person_summary", new=summary):
                    search_response = await self.client.get("/api/chains/person/search", params={"q": "ada"})
                    summary_response = await self.client.get("/api/chains/person", params={"email": "ada@example.com"})
                self.assertEqual(search_response.status_code, 200)
                self.assertEqual(summary_response.status_code, 200)
                self.assertEqual(search.await_args.kwargs["sources"], expected)
                self.assertEqual(summary.await_args.kwargs["sources"], expected)

    async def test_invalid_email_and_short_query_are_rejected(self):
        self.session.set_permissions(["access:manage"])
        with patch("app.cross.api.routes.chains_person.get_actor_permissions", new=AsyncMock(return_value=["access:manage"])):
            bad_email = await self.client.get("/api/chains/person", params={"email": "no-es-correo"})
            short = await self.client.get("/api/chains/person/search", params={"q": "a"})
        self.assertEqual(bad_email.status_code, 422)
        self.assertEqual(short.status_code, 422)

    async def test_email_is_normalized_before_the_repository(self):
        self.session.set_permissions(["pam:catalogs_read"])
        summary = AsyncMock(return_value={"email": "ada@example.com", "name": "", "tools": {}})
        with patch("app.cross.api.routes.chains_person.get_actor_permissions", new=AsyncMock(return_value=["pam:catalogs_read"])), \
             patch("app.cross.api.routes.chains_person.get_person_summary", new=summary):
            response = await self.client.get("/api/chains/person", params={"email": "  Ada@Example.com "})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(summary.await_args.kwargs["email"], "ada@example.com")


if __name__ == "__main__":
    unittest.main()
