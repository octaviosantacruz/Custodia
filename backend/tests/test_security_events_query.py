import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.repositories.security_events import list_security_events


class SecurityEventsQueryShapeTests(unittest.TestCase):
    def test_query_targets_the_dedicated_security_events_table(self):
        with patch("app.repositories.security_events.fetch_all", new=AsyncMock(return_value=[])) as fetch:
            asyncio.run(list_security_events(object()))

        query = fetch.await_args.args[1]
        self.assertIn("public.access_security_events", query)
        self.assertNotIn("access_audit_log", query)

    def test_applies_event_type_and_result_filters(self):
        with patch("app.repositories.security_events.fetch_all", new=AsyncMock(return_value=[])) as fetch:
            asyncio.run(list_security_events(object(), event_type="login_failure", result="failure"))

        query = fetch.await_args.args[1]
        params = fetch.await_args.args[2]
        self.assertIn("event.event_type = %s", query)
        self.assertIn("event.result = %s", query)
        self.assertEqual(params[:2], ("login_failure", "failure"))

    def test_computes_total_count_from_the_window_function(self):
        rows = [{"event_id": 1, "total_count": 7}]
        with patch("app.repositories.security_events.fetch_all", new=AsyncMock(return_value=rows)):
            result = asyncio.run(list_security_events(object()))

        self.assertEqual(result["total"], 7)
        self.assertNotIn("total_count", result["rows"][0])


if __name__ == "__main__":
    unittest.main()
