import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.cross.repositories.operational_logs import list_operational_logs, record_operational_log


class OperationalLogTests(unittest.TestCase):
    def test_list_filters_structured_fields_only(self):
        with patch("app.cross.repositories.operational_logs.fetch_all", new=AsyncMock(return_value=[])) as fetch:
            result = asyncio.run(list_operational_logs(object(), q="Netskope", level="info", source_system="netskope"))

        self.assertEqual(result["total"], 0)
        query, params = fetch.await_args.args[1:]
        self.assertIn("public.operational_log_events", query)
        self.assertEqual(params[:6], ("Netskope",) * 4 + ("info", "netskope"))

    def test_log_write_is_best_effort(self):
        pool = object()
        with patch("app.cross.repositories.operational_logs.AsyncConnectionPool", create=True):
            # A failed connection is swallowed so diagnostics cannot break a sync.
            with patch("app.cross.repositories.operational_logs.Jsonb", side_effect=RuntimeError("no json")):
                asyncio.run(record_operational_log(
                    pool, level="error", source_system="netskope", event="sync_failed",
                    message="Sincronización fallida",
                ))


if __name__ == "__main__":
    unittest.main()
