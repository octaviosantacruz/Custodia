import asyncio
import time
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.repositories.security_events import _safe_actor_id, record_security_event_for_request, security_request_context
import app.auth as auth


class SecurityAuditTests(unittest.TestCase):
    def _request(self):
        return SimpleNamespace(client=SimpleNamespace(host="2001:db8::1"), headers={"X-Request-ID": "req/with spaces-01"})

    def test_context_normalizes_and_digests_identity_values(self):
        context = security_request_context(self._request(), email=" User@Example.COM ")
        self.assertNotIn("User@Example.COM", repr(context))
        self.assertRegex(context["source_ip"], r"^[0-9a-f]{64}$")
        self.assertRegex(context["email_digest"], r"^[0-9a-f]{64}$")
        self.assertEqual(context["request_id"], "reqwithspaces-01")

    def test_request_helper_uses_new_security_events_table_contract(self):
        with patch("app.repositories.security_events.record_security_event", new=AsyncMock()) as record:
            asyncio.run(record_security_event_for_request(
                object(), request=self._request(), event_type="login_failure", result="failure",
                email="user@example.com", mechanism="local", metadata={"reason": "invalid_credentials"},
            ))
        kwargs = record.await_args.kwargs
        self.assertEqual(kwargs["event_type"], "login_failure")
        self.assertEqual(kwargs["result"], "failure")
        self.assertNotIn("user@example.com", repr(kwargs["metadata"]))
        self.assertNotIn("password", repr(kwargs["metadata"]))
        self.assertNotIn("token", repr(kwargs["metadata"]))

    def test_email_actor_ids_are_hashed_before_persistence(self):
        value = _safe_actor_id(" Admin@Example.COM ")
        self.assertNotEqual(value, "admin@example.com")
        self.assertRegex(value, r"^[0-9a-f]{64}$")

    def test_rejected_technical_token_is_a_security_event(self):
        request = SimpleNamespace(session={}, headers={}, client=SimpleNamespace(host="127.0.0.1"), app=SimpleNamespace(state=SimpleNamespace(db=object())))
        with patch.dict("os.environ", {"APP_WRITE_TOKEN": "expected"}), patch.object(auth, "record_security_event_for_request", new=AsyncMock()) as event:
            with self.assertRaises(Exception):
                asyncio.run(auth.require_write_access(request, "wrong"))
        self.assertEqual(event.await_args.kwargs["event_type"], "technical_token_rejected")

    def test_stale_session_is_a_security_event(self):
        request = SimpleNamespace(session={"user": {"actor_id": "actor-1"}}, headers={}, client=SimpleNamespace(host="127.0.0.1"), app=SimpleNamespace(state=SimpleNamespace(db=object())))
        with patch.object(auth, "session_actor", return_value="actor-1"), patch.object(auth, "_session_version_is_stale", new=AsyncMock(return_value=True)), patch.object(auth, "record_security_event_for_request", new=AsyncMock()) as event:
            with self.assertRaises(Exception):
                asyncio.run(auth._require_session_actor(request))
        self.assertEqual(event.await_args.kwargs["event_type"], "session_rejected_stale_version")


if __name__ == "__main__":
    unittest.main()
