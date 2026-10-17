import json
import logging
import sys
import unittest
from datetime import datetime

from app.http_security import ApiSecurityMiddleware
from app.logging_config import JsonLogFormatter, _log_level, reset_request_id, set_request_id


def _record(msg, args=(), exc_info=None):
    return logging.LogRecord(
        name="app.example", level=logging.ERROR, pathname="/srv/custodia/backend/app/example.py",
        lineno=42, msg=msg, args=args, exc_info=exc_info,
    )


class CapturingHandler(logging.Handler):
    def __init__(self):
        super().__init__()
        self.setFormatter(JsonLogFormatter())
        self.payloads = []

    def emit(self, record):
        self.payloads.append(json.loads(self.format(record)))


class StructuredLoggingTests(unittest.TestCase):
    def test_formatter_contains_observability_fields_and_request_id(self):
        token = set_request_id("request-test-123")
        try:
            payload = json.loads(JsonLogFormatter().format(_record("No se pudo sincronizar %s", ("cyberark",))))
        finally:
            reset_request_id(token)

        self.assertEqual(payload["level"], "ERROR")
        self.assertEqual(payload["logger"], "app.example")
        self.assertEqual(payload["file"], "/srv/custodia/backend/app/example.py")
        self.assertEqual(payload["line"], 42)
        self.assertEqual(payload["message"], "No se pudo sincronizar cyberark")
        self.assertEqual(payload["request_id"], "request-test-123")
        self.assertTrue(payload["timestamp"].endswith("Z"))
        datetime.fromisoformat(payload["timestamp"].replace("Z", "+00:00"))

    def test_formatter_includes_exception_traceback(self):
        try:
            raise RuntimeError("safe diagnostic")
        except RuntimeError:
            record = _record("operation failed", exc_info=sys.exc_info())

        payload = json.loads(JsonLogFormatter().format(record))
        self.assertIn("RuntimeError: safe diagnostic", payload["exception"])
        self.assertNotIn("request_id", payload)

    def test_postgres_detail_values_are_redacted_from_message_and_traceback(self):
        detail = (
            'new row for relation "workspace_preferences" violates check constraint "chk_domains"\n'
            'DETAIL:  Failing row contains (ana@example.com, ["safes", "general"], 2026-09-23 01:52:20+00).\n'
            'DETAIL:  Key (email)=(ana@example.com) already exists.\n'
            'DETAIL:  Key (owner_id)=(ana@example.com) is not present in table "users".'
        )
        try:
            raise RuntimeError(detail)
        except RuntimeError:
            record = _record("%s", (detail,), exc_info=sys.exc_info())

        payload = json.loads(JsonLogFormatter().format(record))
        for field in ("message", "exception"):
            self.assertNotIn("ana@example.com", payload[field])
            self.assertIn("Failing row contains (<redactado>)", payload[field])
            self.assertIn("Key (email)=(<redactado>) already exists", payload[field])
            self.assertIn("Key (owner_id)=(<redactado>) is not present", payload[field])
            self.assertIn('check constraint "chk_domains"', payload[field])

    def test_log_level_accepts_level_names_and_ignores_other_logging_attributes(self):
        self.assertEqual(_log_level("warning"), logging.WARNING)
        self.assertEqual(_log_level(" DEBUG "), logging.DEBUG)
        self.assertEqual(_log_level(None), logging.INFO)
        # getattr(logging, name) used to return this format string and crash startup.
        self.assertEqual(_log_level("BASIC_FORMAT"), logging.INFO)
        self.assertEqual(_log_level("verbose"), logging.INFO)


class RequestIdPropagationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.logger = logging.getLogger("test.request_id")
        self.logger.propagate = False
        self.handler = CapturingHandler()
        self.logger.addHandler(self.handler)
        self.logger.setLevel(logging.INFO)
        self.addCleanup(self.logger.removeHandler, self.handler)

    async def _call(self, application, method="GET", headers=None):
        messages = []

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            # Uvicorn writes its access line from inside send().
            if message["type"] == "http.response.start":
                self.logger.info("access %s", message["status"])
            messages.append(message)

        scope = {
            "type": "http", "method": method, "path": "/api/summary", "scheme": "http",
            "headers": [(key.lower().encode(), value.encode()) for key, value in (headers or {}).items()],
        }
        await ApiSecurityMiddleware(application, ["https://custodia.example"])(scope, receive, send)
        start = next(message for message in messages if message["type"] == "http.response.start")
        return start["status"], dict(start["headers"])[b"x-request-id"].decode()

    async def test_logs_inside_a_request_carry_the_returned_request_id(self):
        async def application(_scope, _receive, send):
            self.logger.info("handling request")
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"{}"})

        status, request_id = await self._call(application)

        self.assertEqual(status, 200)
        self.assertEqual([payload["message"] for payload in self.handler.payloads], ["handling request", "access 200"])
        self.assertEqual({payload["request_id"] for payload in self.handler.payloads}, {request_id})

    async def test_rejected_requests_also_carry_the_request_id(self):
        async def application(_scope, _receive, _send):
            raise AssertionError("a rejected request must not reach the app")

        status, request_id = await self._call(application, method="POST", headers={"Origin": "https://evil.example"})

        self.assertEqual(status, 403)
        self.assertEqual(self.handler.payloads[0]["request_id"], request_id)

    async def test_request_id_does_not_leak_after_the_request(self):
        async def application(_scope, _receive, send):
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"{}"})

        await self._call(application)
        self.logger.info("background work")

        self.assertNotIn("request_id", self.handler.payloads[-1])


if __name__ == "__main__":
    unittest.main()
