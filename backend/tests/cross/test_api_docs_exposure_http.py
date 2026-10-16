"""PENTEST-010: the API reference/openapi.json exposed operations publicly
with no session required. Not something a mocked unit test on AppSettings
alone can fully prove -- this checks the actual ASGI app whose docs_url/
openapi_url are wired straight from AppSettings.expose_api_docs in
app/main.py.

Only proves the default-enabled path here: app.main's module-level
`SETTINGS = AppSettings.from_environment()` runs once per test process
(the first time any test module imports app.main), so this test process
already has EXPOSE_API_DOCS unset -> True by the time this module loads.
test_config.py's AppSettingsTests cover the disabled branch directly
against AppSettings, isolated from the app singleton."""

import os
import unittest

os.environ.update({
    'DATABASE_URL': 'postgresql://test:test@127.0.0.1:5432/cmdb',
    'SESSION_SECRET': 'test-only-session-secret-at-least-32-bytes',
    'INGESTION_INTERVAL_MINUTES': '1440',
    'AUTH_MODE': 'local',
    'SESSION_HTTPS_ONLY': 'false',
})

import httpx  # noqa: E402

from app.docs_theme import SCALAR_JS_URL  # noqa: E402
from app.main import app  # noqa: E402


class ApiDocsExposedByDefaultTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        transport = httpx.ASGITransport(app=app)
        self.client = httpx.AsyncClient(transport=transport, base_url="http://testserver")
        self.addAsyncCleanup(self.client.aclose)

    async def test_docs_and_openapi_are_reachable_with_the_packaged_default(self):
        docs = await self.client.get("/docs")
        openapi = await self.client.get("/openapi.json")
        self.assertEqual(docs.status_code, 200)
        self.assertEqual(openapi.status_code, 200)
        self.assertIn("paths", openapi.json())

    async def test_docs_use_the_ds_hub_theme_instead_of_the_swagger_default(self):
        """/docs must render app/docs_theme.py's branded Scalar reference, not
        a bare swagger-ui-dist shell -- a regression here would silently drop
        the theme and go back to the generic orange Swagger look."""
        docs = await self.client.get("/docs")
        self.assertIn(SCALAR_JS_URL, docs.text)
        self.assertIn("Scalar.createApiReference", docs.text)
        self.assertIn("#35c477", docs.text)  # DS Hub accent green
        self.assertIn("data:image/svg+xml", docs.text)  # inlined favicon
        self.assertNotIn("swagger-ui", docs.text.lower())
        # No AI assistant and no Scalar cloud toolbar: the schema stays
        # inside DS Hub's own deployment.
        self.assertIn('"agent": {"disabled": true}', docs.text)
        self.assertIn('"showDeveloperTools": "never"', docs.text)
        self.assertIn('"mcp": {"disabled": true}', docs.text)
        self.assertIn('"hideClientButton": true', docs.text)
        self.assertIn('"hideModels": true', docs.text)
        self.assertIn('"telemetry": false', docs.text)

    async def test_redoc_is_retired_with_the_scalar_reference(self):
        # /redoc used to stay enabled but unthemed; the Scalar reference is
        # now the single published UI.
        redoc = await self.client.get("/redoc")
        self.assertEqual(redoc.status_code, 404)

    async def test_auth_status_signal_is_false_without_a_session(self):
        """DOCS-PORTAL-001: the guide links /docs only from the authenticated
        session signal. An unauthenticated request must never receive True,
        and receiving False must not change what this app serves -- the
        endpoints below stay reachable solely because EXPOSE_API_DOCS is on."""
        status = await self.client.get("/api/auth/status")
        self.assertEqual(status.status_code, 200)
        payload = status.json()
        self.assertFalse(payload["api_docs_enabled"])
        docs = await self.client.get("/docs")
        openapi = await self.client.get("/openapi.json")
        self.assertEqual(docs.status_code, 200)
        self.assertEqual(openapi.status_code, 200)


if __name__ == "__main__":
    unittest.main()
