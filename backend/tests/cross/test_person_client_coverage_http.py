"""CONN-001 HTTP contract: source permissions gate both aggregate and detail."""

import os
import unittest
from contextlib import ExitStack
from unittest.mock import AsyncMock, patch

import httpx

from tests.cross.test_permission_http_matrix import (
    TechnicalTokenScopeHttpTests,
    _AuthenticatedSession,
    app,
)


SOURCES = {
    "identity": {
        "source_system": "identity_administration", "source_file": "identity-administration-scim",
        "run_id": "identity-1", "status": "completed", "started_at": "2026-09-30T10:00:00Z",
        "completed_at": "2026-09-30T10:01:00Z", "freshness": "fresh", "age_hours": 1.0,
    },
    "netskope": {
        "source_system": "netskope", "source_file": "netskope-api",
        "run_id": "netskope-1", "status": "completed", "started_at": "2026-09-30T10:00:00Z",
        "completed_at": "2026-09-30T10:01:00Z", "freshness": "fresh", "age_hours": 1.0,
    },
}
SUMMARY = {
    "metric_code": "CONN-001", "metric_version": "1",
    "label": "Cliente Netskope activo y observado recientemente",
    "population": "Usuarios humanos activos de Identity Administration",
    "person_freshness_hours": 24, "device_freshness_days": 7,
    "counts": {
        "denominator": 2, "covered": 1, "partial": 0, "gap": 0, "unknown": 1,
        "coverage_percent": 50.0, "devices_recent": 1, "devices_total": 1,
        "device_coverage_percent": 100.0,
    },
    "sources": SOURCES,
}
DETAIL = {
    "metric_code": "CONN-001", "metric_version": "1", "email": "ada@example.test",
    "status": "covered", "identity_records": 1, "netskope_users": 1,
    "devices_recent": 1, "devices_not_recent": 0, "devices_total": 1, "devices_ambiguous": 0,
    "sources": SOURCES, "explanation": "Todos los dispositivos activos vinculados son recientes (últimos 7 días).",
}


class PersonClientCoverageHttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")
        self.addAsyncCleanup(self.client.aclose)
        self.session = _AuthenticatedSession(self.stack, self.client)
        await self.session.login()

    async def test_either_missing_source_permission_denies_before_repository(self):
        repository = AsyncMock(return_value=SUMMARY)
        for permissions in (["identity:catalogs_read"], ["netskope:read"], []):
            with self.subTest(permissions=permissions):
                self.session.set_permissions(permissions)
                with patch("app.cross.api.routes.chains_person.get_actor_permissions", new=AsyncMock(return_value=permissions)), \
                     patch("app.cross.api.routes.chains_person.get_person_client_coverage", new=repository), \
                     patch("app.cross.api.routes.chains_person.get_person_client_coverage_detail", new=repository):
                    summary = await self.client.get("/api/chains/person/coverage")
                    detail = await self.client.get(
                        "/api/chains/person/coverage/detail", params={"email": "ada@example.test"},
                    )
                self.assertEqual(summary.status_code, 403)
                self.assertEqual(detail.status_code, 403)
        repository.assert_not_awaited()

    async def test_both_permissions_and_access_manage_authorize_both_routes(self):
        summary_repo = AsyncMock(return_value=SUMMARY)
        detail_repo = AsyncMock(return_value=DETAIL)
        for permissions in (
            ["identity:catalogs_read", "netskope:read"], ["access:manage"],
        ):
            with self.subTest(permissions=permissions):
                self.session.set_permissions(permissions)
                with patch("app.cross.api.routes.chains_person.get_actor_permissions", new=AsyncMock(return_value=permissions)), \
                     patch("app.cross.api.routes.chains_person.get_person_client_coverage", new=summary_repo), \
                     patch("app.cross.api.routes.chains_person.get_person_client_coverage_detail", new=detail_repo):
                    summary = await self.client.get("/api/chains/person/coverage")
                    detail = await self.client.get(
                        "/api/chains/person/coverage/detail", params={"email": " Ada@Example.Test "},
                    )
                self.assertEqual(summary.status_code, 200)
                self.assertEqual(summary.json()["counts"]["unknown"], 1)
                self.assertEqual(detail.status_code, 200)
                self.assertEqual(detail_repo.await_args.kwargs["email"], "ada@example.test")
        self.assertEqual(summary_repo.await_count, 2)
        self.assertEqual(detail_repo.await_count, 2)

    async def test_existing_person_view_still_works_for_one_source_without_coverage_read(self):
        permissions = ["identity:catalogs_read"]
        self.session.set_permissions(permissions)
        old_route = AsyncMock(return_value={"email": "ada@example.test", "name": "Ada", "tools": {}})
        coverage = AsyncMock(return_value=SUMMARY)
        with patch("app.cross.api.routes.chains_person.get_actor_permissions", new=AsyncMock(return_value=permissions)), \
             patch("app.cross.api.routes.chains_person.get_person_summary", new=old_route), \
             patch("app.cross.api.routes.chains_person.get_person_client_coverage", new=coverage):
            response = await self.client.get("/api/chains/person", params={"email": "ada@example.test"})
            denied = await self.client.get("/api/chains/person/coverage")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(denied.status_code, 403)
        old_route.assert_awaited_once()
        coverage.assert_not_awaited()

    async def test_read_route_rejects_write_only_technical_token(self):
        summary_repo = AsyncMock(return_value=SUMMARY)
        detail_repo = AsyncMock(return_value=DETAIL)
        token = TechnicalTokenScopeHttpTests.TOKEN
        with patch.dict(os.environ, {"APP_WRITE_TOKEN": token, "APP_ACTOR_ID": "automation-actor"}), \
             patch("app.cross.api.routes.chains_person.get_person_client_coverage", new=summary_repo), \
             patch("app.cross.api.routes.chains_person.get_person_client_coverage_detail", new=detail_repo):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://testserver",
            ) as technical_client:
                headers = {"X-Access-Token": token}
                summary = await technical_client.get("/api/chains/person/coverage", headers=headers)
                detail = await technical_client.get(
                    "/api/chains/person/coverage/detail", params={"email": "ada@example.test"}, headers=headers,
                )
        self.assertEqual(summary.status_code, 401)
        self.assertEqual(detail.status_code, 401)
        summary_repo.assert_not_awaited()
        detail_repo.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
