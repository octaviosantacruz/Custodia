import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.api.routes.health import health, liveness


class HealthRouteTests(unittest.TestCase):
    def test_liveness_does_not_touch_database(self):
        self.assertEqual(asyncio.run(liveness()), {"status": "ok"})

    def test_readiness_checks_database(self):
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=object())))
        with patch("app.api.routes.health.fetch_one", new=AsyncMock(return_value={"?column?": 1})) as query:
            self.assertEqual(asyncio.run(health(request)), {"status": "ok"})
        query.assert_awaited_once_with(request.app.state.db, "SELECT 1")


if __name__ == "__main__":
    unittest.main()
