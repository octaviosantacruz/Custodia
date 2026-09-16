"""PENTEST-010: Swagger/ReDoc/openapi.json exposed 103 operations publicly
with no session required. Not something a mocked unit test on AppSettings
alone can fully prove -- this checks the actual ASGI app whose docs_url/
redoc_url/openapi_url are wired straight from AppSettings.expose_api_docs
in app/main.py.

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


if __name__ == "__main__":
    unittest.main()
