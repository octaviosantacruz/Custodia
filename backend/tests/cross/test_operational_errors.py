import asyncio
import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from starlette.requests import Request

from app.operational_errors import internal_server_error
from app.cross.repositories.operational_errors import list_operational_errors, safe_error_kind


class OperationalErrorTests(unittest.TestCase):
    def test_unhandled_error_returns_a_safe_reference_and_persists_no_message(self):
        request = Request({
            "type": "http", "method": "GET", "path": "/api/cmdb/netskope/metrics",
            "headers": [], "query_string": b"", "app": SimpleNamespace(state=SimpleNamespace(db=object())),
            "state": {"request_id": "request-safe-123"},
        })
        error = RuntimeError("password=must-not-leak")
        with patch("app.operational_errors.record_operational_error", new=AsyncMock()) as record:
            response = asyncio.run(internal_server_error(request, error))
        body = json.loads(response.body)
        self.assertEqual(response.status_code, 500)
        self.assertEqual(body["detail"], "Error interno del servidor. Referencia: request-safe-123")
        self.assertNotIn("password", body["detail"])
        self.assertEqual(record.await_args.kwargs["path"], "/api/cmdb/netskope/metrics")
        self.assertIs(record.await_args.kwargs["error"], error)

    def test_query_is_limited_to_safe_operational_fields(self):
        with patch("app.cross.repositories.operational_errors.fetch_all", new=AsyncMock(return_value=[])) as fetch:
            result = asyncio.run(list_operational_errors(object(), q="request-safe-123"))
        query, params = fetch.await_args.args[1:]
        self.assertEqual(result["total"], 0)
        self.assertIn("public.operational_error_events", query)
        self.assertNotIn("message", query.casefold())
        self.assertEqual(params[:3], ("request-safe-123",) * 3)

    def test_error_kind_never_uses_exception_text(self):
        self.assertEqual(safe_error_kind(RuntimeError("token=secret")), "RuntimeError")


if __name__ == "__main__":
    unittest.main()
