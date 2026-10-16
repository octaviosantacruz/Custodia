import asyncio
import time
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.auth import SESSION_LAST_ACTIVITY_AT, SESSION_STARTED_AT, get_actor_permissions, require_read_access, require_write_access, session_actor


class ReadAccessTests(unittest.TestCase):
    def request(self, actor_id="reader-1"):
        return SimpleNamespace(
            session={
                "user": {"actor_id": actor_id, "auth_source": "oidc"},
                SESSION_STARTED_AT: time.time(),
                SESSION_LAST_ACTIVITY_AT: time.time(),
            },
            state=SimpleNamespace(),
            app=SimpleNamespace(state=SimpleNamespace(db=object())),
        )

    def test_requires_inventory_read_permission(self):
        request = self.request()
        with patch("app.auth.get_actor_permissions", new=AsyncMock(return_value=["catalogs:read"])):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(require_read_access(request))
        self.assertEqual(error.exception.status_code, 403)

    def test_allows_reader_and_sets_actor(self):
        request = self.request()
        with patch("app.auth.get_actor_permissions", new=AsyncMock(return_value=["inventory:read"])):
            actor = asyncio.run(require_read_access(request))
        self.assertEqual(actor, "reader-1")
        self.assertEqual(request.state.actor_id, "reader-1")

    def test_requires_a_session(self):
        request = self.request()
        request.session = {}
        with self.assertRaises(HTTPException) as error:
            asyncio.run(require_read_access(request))
        self.assertEqual(error.exception.status_code, 401)

    def test_refreshes_activity_for_a_valid_session(self):
        request = self.request()
        request.app.state.session_idle_timeout_seconds = 900
        request.app.state.session_max_age_seconds = 3600
        request.session.update({SESSION_STARTED_AT: 900, SESSION_LAST_ACTIVITY_AT: 950})
        with patch("app.auth.time.time", return_value=1000):
            actor = session_actor(request)
        self.assertEqual(actor, "reader-1")
        self.assertEqual(request.session[SESSION_LAST_ACTIVITY_AT], 1000)

    def test_clears_a_session_after_idle_timeout(self):
        request = self.request()
        request.app.state.session_idle_timeout_seconds = 900
        request.app.state.session_max_age_seconds = 3600
        request.session.update({SESSION_STARTED_AT: 100, SESSION_LAST_ACTIVITY_AT: 100})
        with patch("app.auth.time.time", return_value=1001):
            actor = session_actor(request)
        self.assertIsNone(actor)
        self.assertEqual(request.session, {})

    def test_clears_legacy_sessions_without_activity_metadata(self):
        request = self.request()
        request.session.pop(SESSION_STARTED_AT)
        request.session.pop(SESSION_LAST_ACTIVITY_AT)
        self.assertIsNone(session_actor(request))
        self.assertEqual(request.session, {})


class PermissionQueryTests(unittest.TestCase):
    def test_permissions_ignore_roles_of_inactive_local_users(self):
        with patch("app.cross.repositories.auth_queries.fetch_all", new=AsyncMock(return_value=[])) as fetch:
            asyncio.run(get_actor_permissions(object(), "disabled-1"))
        self.assertIn("u.is_active = true", fetch.await_args.args[1])

    def test_permissions_are_resolved_through_the_effective_role_view(self):
        with patch("app.cross.repositories.auth_queries.fetch_all", new=AsyncMock(return_value=[])) as fetch:
            asyncio.run(get_actor_permissions(object(), "custom-role-user"))
        self.assertIn("access_effective_role_permissions", fetch.await_args.args[1])


class MustChangePasswordEnforcementTests(unittest.TestCase):
    """PENTEST-002: must_change_password was only enforced by the frontend
    hiding the rest of the UI; the API itself let a session with a pending
    temporary password call anything require_read_access/require_write_access
    guarded. These tests exercise the dependency functions directly (a
    matching HTTP-level proof lives in test_permission_http_matrix.py)."""

    def request(self, *, must_change_password: bool, method: str = "GET", path: str = "/api/summary"):
        return SimpleNamespace(
            session={
                "user": {"actor_id": "temp-1", "must_change_password": must_change_password, "auth_source": "oidc"},
                SESSION_STARTED_AT: time.time(),
                SESSION_LAST_ACTIVITY_AT: time.time(),
            },
            method=method,
            url=SimpleNamespace(path=path),
            state=SimpleNamespace(),
            app=SimpleNamespace(state=SimpleNamespace(db=object())),
        )

    def test_require_read_access_blocks_an_arbitrary_route_with_a_pending_password_change(self):
        request = self.request(must_change_password=True, method="GET", path="/api/summary")
        with patch("app.auth.get_actor_permissions", new=AsyncMock(return_value=["inventory:read"])):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(require_read_access(request))
        self.assertEqual(error.exception.status_code, 403)

    def test_require_read_access_allows_the_password_change_route_itself(self):
        request = self.request(must_change_password=True, method="POST", path="/api/auth/password")
        with patch("app.auth.get_actor_permissions", new=AsyncMock(return_value=["inventory:read"])):
            actor = asyncio.run(require_read_access(request))
        self.assertEqual(actor, "temp-1")

    def test_require_write_access_blocks_an_arbitrary_route_with_a_pending_password_change(self):
        request = self.request(must_change_password=True, method="POST", path="/api/auth/users")
        with self.assertRaises(HTTPException) as error:
            asyncio.run(require_write_access(request, x_access_token=None))
        self.assertEqual(error.exception.status_code, 403)

    def test_no_enforcement_once_the_password_has_been_changed(self):
        request = self.request(must_change_password=False, method="GET", path="/api/summary")
        with patch("app.auth.get_actor_permissions", new=AsyncMock(return_value=["inventory:read"])):
            actor = asyncio.run(require_read_access(request))
        self.assertEqual(actor, "temp-1")

    def test_automation_token_actor_is_not_affected_by_a_browser_sessions_pending_change(self):
        """A request authenticated only via X-Access-Token has no browser
        session/user dict at all, so this check must never block it."""
        request = SimpleNamespace(
            session={},
            method="POST",
            url=SimpleNamespace(path="/api/safes/bulk-assignment"),
            state=SimpleNamespace(),
            app=SimpleNamespace(state=SimpleNamespace(db=object())),
        )
        with patch("app.auth._local_actor", return_value="local-admin"):
            actor = asyncio.run(require_write_access(request, x_access_token="whatever"))
        self.assertEqual(actor, "local-admin")


class SessionVersionEnforcementTests(unittest.TestCase):
    """PENTEST-004: a stolen session cookie must stop working the moment
    the account's password is changed/reset or it's deactivated, even
    though the cookie itself is still validly signed and unexpired."""

    def request(self, *, session_version, method: str = "GET", path: str = "/api/summary"):
        return SimpleNamespace(
            session={
                "user": {"actor_id": "actor-1", "session_version": session_version},
                SESSION_STARTED_AT: time.time(),
                SESSION_LAST_ACTIVITY_AT: time.time(),
            },
            method=method,
            url=SimpleNamespace(path=path),
            state=SimpleNamespace(),
            app=SimpleNamespace(state=SimpleNamespace(db=object())),
        )

    def test_require_read_access_401s_and_clears_the_session_on_a_version_mismatch(self):
        request = self.request(session_version=1)
        with patch("app.auth.get_session_version", new=AsyncMock(return_value=2)), \
             patch("app.auth.record_security_event_for_request", new=AsyncMock()) as security_event:
            with self.assertRaises(HTTPException) as error:
                asyncio.run(require_read_access(request))
        self.assertEqual(error.exception.status_code, 401)
        self.assertEqual(request.session, {})
        # PENTEST-008: a stale session_version (stolen/reused cookie past a
        # password reset or deactivation) is a persisted security event.
        self.assertEqual(security_event.await_args.kwargs["event_type"], "session_rejected_stale_version")
        self.assertEqual(security_event.await_args.kwargs["actor_id"], "actor-1")

    def test_require_read_access_401s_when_the_account_no_longer_exists_or_is_inactive(self):
        """get_session_version returns None for a missing/deactivated
        account -- must be treated the same as a version mismatch, not
        silently allowed through."""
        request = self.request(session_version=1)
        with patch("app.auth.get_session_version", new=AsyncMock(return_value=None)):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(require_read_access(request))
        self.assertEqual(error.exception.status_code, 401)

    def test_require_read_access_allows_a_matching_version(self):
        request = self.request(session_version=1)
        with patch("app.auth.get_session_version", new=AsyncMock(return_value=1)), \
             patch("app.auth.get_actor_permissions", new=AsyncMock(return_value=["inventory:read"])):
            actor = asyncio.run(require_read_access(request))
        self.assertEqual(actor, "actor-1")

    def test_require_write_access_401s_on_a_version_mismatch(self):
        request = self.request(session_version=1, method="POST", path="/api/safes/bulk-assignment")
        with patch("app.auth.get_session_version", new=AsyncMock(return_value=2)):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(require_write_access(request, x_access_token=None))
        self.assertEqual(error.exception.status_code, 401)

    def test_oidc_style_sessions_without_a_session_version_key_are_unaffected(self):
        """OIDC-authenticated sessions never carry a session_version (DS
        Hub doesn't manage their credentials); the check must never touch
        the database for them."""
        request = SimpleNamespace(
            session={
                "user": {"actor_id": "oidc-actor", "auth_source": "oidc"},
                SESSION_STARTED_AT: time.time(),
                SESSION_LAST_ACTIVITY_AT: time.time(),
            },
            method="GET",
            url=SimpleNamespace(path="/api/summary"),
            state=SimpleNamespace(),
            app=SimpleNamespace(state=SimpleNamespace(db=object())),
        )
        with patch("app.auth.get_session_version", new=AsyncMock()) as version_mock, \
             patch("app.auth.get_actor_permissions", new=AsyncMock(return_value=["inventory:read"])):
            actor = asyncio.run(require_read_access(request))
        self.assertEqual(actor, "oidc-actor")
        version_mock.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
