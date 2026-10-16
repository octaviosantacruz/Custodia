import asyncio
import os
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.auth import hash_password, require_any_permission, require_permission, require_write_access, verify_password


class WriteAccessTests(unittest.TestCase):
    def run_auth(self, token):
        request = SimpleNamespace(state=SimpleNamespace(), app=SimpleNamespace(state=SimpleNamespace(db=object())))
        return asyncio.run(require_write_access(request, token))



    def test_password_policy_requires_complexity(self):
        for password in ("short1!", "alllower1!", "ALLUPPER1!", "NoNumber!", "NoSpecial1"):
            with self.assertRaises(ValueError):
                hash_password(password)

    def test_password_policy_accepts_eight_character_complex_password(self):
        encoded = hash_password("Abcdef123456789!")
        self.assertTrue(verify_password("Abcdef123456789!", encoded))
        self.assertFalse(verify_password("wrong1!A", encoded))

    def test_write_access_is_disabled_without_configuration(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(HTTPException, "APP_WRITE_TOKEN") as error:
                self.run_auth(None)
        self.assertEqual(error.exception.status_code, 503)

    def test_write_access_rejects_invalid_token(self):
        with patch.dict(os.environ, {"APP_WRITE_TOKEN": "expected"}, clear=True), \
             patch("app.auth.record_security_event_for_request", new=AsyncMock()) as security_event:
            with self.assertRaises(HTTPException) as error:
                self.run_auth("wrong")
        self.assertEqual(error.exception.status_code, 401)
        # PENTEST-008: a rejected technical token is a persisted security event.
        self.assertEqual(security_event.await_args.kwargs["event_type"], "technical_token_rejected")
        self.assertEqual(security_event.await_args.kwargs["result"], "failure")

    def test_write_access_sets_actor_for_valid_token(self):
        with patch.dict(
            os.environ,
            {"APP_WRITE_TOKEN": "expected", "APP_ACTOR_ID": "operator-1"},
            clear=True,
        ):
            request = SimpleNamespace(state=SimpleNamespace())
            actor = asyncio.run(require_write_access(request, "expected"))
        self.assertEqual(actor, "operator-1")
        self.assertEqual(request.state.actor_id, "operator-1")



    def test_permission_denies_actor_without_required_permission(self):
        request = SimpleNamespace(
            state=SimpleNamespace(),
            app=SimpleNamespace(state=SimpleNamespace(db=object())),
        )
        dependency = require_permission("catalogs:write")
        with patch.dict(
            os.environ,
            {"APP_WRITE_TOKEN": "expected", "APP_ACTOR_ID": "reader-1"},
            clear=True,
        ), patch("app.auth.get_actor_permissions", return_value=["inventory:read"]):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(dependency(request, "expected"))
        self.assertEqual(error.exception.status_code, 403)

    def test_permission_allows_actor_with_required_permission(self):
        request = SimpleNamespace(
            state=SimpleNamespace(),
            app=SimpleNamespace(state=SimpleNamespace(db=object())),
        )
        dependency = require_permission("catalogs:write")
        with patch.dict(
            os.environ,
            {"APP_WRITE_TOKEN": "expected", "APP_ACTOR_ID": "admin-1"},
            clear=True,
        ), patch("app.auth.get_actor_permissions", return_value=["catalogs:write"]):
            actor = asyncio.run(dependency(request, "expected"))
        self.assertEqual(actor, "admin-1")

    def test_any_permission_denies_actor_with_neither_code(self):
        request = SimpleNamespace(
            state=SimpleNamespace(),
            app=SimpleNamespace(state=SimpleNamespace(db=object())),
        )
        dependency = require_any_permission("access:manage", "pam:catalogs_read")
        with patch.dict(
            os.environ,
            {"APP_WRITE_TOKEN": "expected", "APP_ACTOR_ID": "reader-1"},
            clear=True,
        ), patch("app.auth.get_actor_permissions", return_value=["inventory:read"]):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(dependency(request, "expected"))
        self.assertEqual(error.exception.status_code, 403)

    def test_any_permission_allows_actor_with_the_broad_code(self):
        request = SimpleNamespace(
            state=SimpleNamespace(),
            app=SimpleNamespace(state=SimpleNamespace(db=object())),
        )
        dependency = require_any_permission("access:manage", "pam:catalogs_read")
        with patch.dict(
            os.environ,
            {"APP_WRITE_TOKEN": "expected", "APP_ACTOR_ID": "admin-1"},
            clear=True,
        ), patch("app.auth.get_actor_permissions", return_value=["access:manage"]):
            actor = asyncio.run(dependency(request, "expected"))
        self.assertEqual(actor, "admin-1")

    def test_any_permission_allows_actor_with_only_the_narrow_code(self):
        request = SimpleNamespace(
            state=SimpleNamespace(),
            app=SimpleNamespace(state=SimpleNamespace(db=object())),
        )
        dependency = require_any_permission("access:manage", "pam:catalogs_read")
        with patch.dict(
            os.environ,
            {"APP_WRITE_TOKEN": "expected", "APP_ACTOR_ID": "pam-operator-1"},
            clear=True,
        ), patch("app.auth.get_actor_permissions", return_value=["pam:catalogs_read"]):
            actor = asyncio.run(dependency(request, "expected"))
        self.assertEqual(actor, "pam-operator-1")

    def test_any_permission_requires_at_least_one_code(self):
        with self.assertRaises(ValueError):
            require_any_permission()

if __name__ == "__main__":
    unittest.main()
