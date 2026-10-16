"""Behavior coverage for the auth_session.py/auth_bootstrap.py routes,
mocking the repository layer they now call (repositories/access_control.py).
SQL-shape/transaction assertions live in test_access_control_queries.py.
"""
import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.cross.api.routes.auth_bootstrap import bootstrap, register_first_user
from app.cross.api.routes.auth_models import BootstrapRequest, LocalLogin
from app.cross.api.routes.auth_session import auth_setup_status, local_login
from app.cross.repositories.auth_queries import FirstUserAlreadyExists


def _request(client_host="10.0.0.1", db=None):
    return SimpleNamespace(
        session={},
        client=SimpleNamespace(host=client_host),
        headers={},
        app=SimpleNamespace(state=SimpleNamespace(db=db)),
    )


class AuthSetupStatusTests(unittest.TestCase):
    def test_available_when_no_users_exist_and_local_auth_is_enabled(self):
        request = _request(db=object())
        with patch("app.cross.api.routes.auth_session.count_local_users", new=AsyncMock(return_value=0)), \
             patch("app.cross.api.routes.auth_session.LOCAL_AUTH_ENABLED", True), \
             patch("app.cross.api.routes.auth_session.SELF_REGISTER_SETUP_ENABLED", True):
            result = asyncio.run(auth_setup_status(request))
        self.assertEqual(result, {"available": True})

    def test_not_available_once_a_user_exists(self):
        request = _request(db=object())
        with patch("app.cross.api.routes.auth_session.count_local_users", new=AsyncMock(return_value=1)), \
             patch("app.cross.api.routes.auth_session.LOCAL_AUTH_ENABLED", True), \
             patch("app.cross.api.routes.auth_session.SELF_REGISTER_SETUP_ENABLED", True):
            result = asyncio.run(auth_setup_status(request))
        self.assertEqual(result, {"available": False})

    def test_not_available_when_local_auth_is_disabled_even_without_users(self):
        request = _request(db=object())
        with patch("app.cross.api.routes.auth_session.count_local_users", new=AsyncMock(return_value=0)), \
             patch("app.cross.api.routes.auth_session.LOCAL_AUTH_ENABLED", False), \
             patch("app.cross.api.routes.auth_session.SELF_REGISTER_SETUP_ENABLED", True):
            result = asyncio.run(auth_setup_status(request))
        self.assertEqual(result, {"available": False})

    def test_not_available_when_self_register_setup_is_disabled_by_default(self):
        """PENTEST-001: with ALLOW_SELF_REGISTER_SETUP off (the default),
        the setup window must never be advertised, even with local auth
        enabled and zero users -- the only path left is
        POST /api/auth/bootstrap with AUTH_BOOTSTRAP_TOKEN."""
        request = _request(db=object())
        with patch("app.cross.api.routes.auth_session.count_local_users", new=AsyncMock(return_value=0)) as count_mock, \
             patch("app.cross.api.routes.auth_session.LOCAL_AUTH_ENABLED", True), \
             patch("app.cross.api.routes.auth_session.SELF_REGISTER_SETUP_ENABLED", False):
            result = asyncio.run(auth_setup_status(request))
        self.assertEqual(result, {"available": False})
        count_mock.assert_not_awaited()  # short-circuits before touching the database


class LocalLoginTests(unittest.TestCase):
    def setUp(self):
        # PENTEST-006: the rate limiter is now backed by the real database
        # (shared/atomic across workers); these tests exercise the route
        # logic in isolation, so its reserve/clear calls are mocked out
        # like every other repository call here.
        self.enterContext(patch("app.cross.api.routes.auth_session.enforce_rate_limit", new=AsyncMock(return_value=None)))
        self.enterContext(patch("app.cross.api.routes.auth_session.clear_rate_limit", new=AsyncMock(return_value=None)))

    def _user_row(self, **overrides):
        row = {
            "actor_id": "reader-1", "email": "reader@example.com", "display_name": "Reader",
            "password_hash": "hash", "must_change_password": False, "session_version": 1,
            "roles": ["reader"], "role_names": ["Lector"],
        }
        row.update(overrides)
        return row

    def test_unknown_email_and_wrong_password_return_the_same_error(self):
        request_unknown = _request(client_host="10.0.0.2", db=object())
        with patch("app.cross.services.local_authentication.find_local_user_for_login", new=AsyncMock(return_value=None)), \
             patch("app.cross.api.routes.auth_session.LOCAL_AUTH_ENABLED", True):
            with self.assertRaises(HTTPException) as unknown_error:
                asyncio.run(local_login(LocalLogin(email="ghost@example.com", password="whatever1"), request_unknown))

        request_wrong = _request(client_host="10.0.0.3", db=object())
        with patch("app.cross.services.local_authentication.find_local_user_for_login", new=AsyncMock(return_value=self._user_row())), \
             patch("app.cross.services.local_authentication.verify_password_async", new=AsyncMock(return_value=False)), \
             patch("app.cross.api.routes.auth_session.LOCAL_AUTH_ENABLED", True):
            with self.assertRaises(HTTPException) as wrong_error:
                asyncio.run(local_login(LocalLogin(email="reader@example.com", password="wrong1!A"), request_wrong))

        self.assertEqual(unknown_error.exception.status_code, 401)
        self.assertEqual(wrong_error.exception.status_code, 401)
        self.assertEqual(unknown_error.exception.detail, wrong_error.exception.detail)

    def test_successful_login_starts_a_session_with_roles(self):
        request = _request(client_host="10.0.0.4", db=object())
        with patch("app.cross.services.local_authentication.find_local_user_for_login", new=AsyncMock(return_value=self._user_row())), \
             patch("app.cross.services.local_authentication.verify_password_async", new=AsyncMock(return_value=True)), \
             patch("app.cross.api.routes.auth_session.record_security_event_for_request", new=AsyncMock()) as security_event, \
             patch("app.cross.api.routes.auth_session.LOCAL_AUTH_ENABLED", True):
            result = asyncio.run(local_login(LocalLogin(email="reader@example.com", password="Abcdef1!"), request))
        self.assertTrue(result["authenticated"])
        self.assertEqual(request.session["user"]["actor_id"], "reader-1")
        self.assertEqual(request.session["user"]["roles"], ["reader"])
        self.assertEqual(security_event.await_args.kwargs["event_type"], "login_success")
        self.assertEqual(security_event.await_args.kwargs["result"], "success")

    def test_failed_login_records_security_event_without_password_or_token(self):
        request = _request(client_host="10.0.0.41", db=object())
        with patch("app.cross.services.local_authentication.find_local_user_for_login", new=AsyncMock(return_value=self._user_row())), \
             patch("app.cross.services.local_authentication.verify_password_async", new=AsyncMock(return_value=False)), \
             patch("app.cross.api.routes.auth_session.record_security_event_for_request", new=AsyncMock()) as security_event, \
             patch("app.cross.api.routes.auth_session.LOCAL_AUTH_ENABLED", True):
            with self.assertRaises(HTTPException):
                asyncio.run(local_login(LocalLogin(email="reader@example.com", password="Abcdef123456789!"), request))
        self.assertEqual(security_event.await_args.kwargs["event_type"], "login_failure")
        self.assertEqual(security_event.await_args.kwargs["result"], "failure")
        self.assertNotIn("password", repr(security_event.await_args.kwargs))

    def test_rate_limited_login_records_block_event(self):
        request = _request(client_host="10.0.0.42", db=object())
        with patch("app.cross.api.routes.auth_session.enforce_rate_limit", new=AsyncMock(side_effect=HTTPException(status_code=429, detail="blocked"))), \
             patch("app.cross.api.routes.auth_session.record_security_event_for_request", new=AsyncMock()) as security_event, \
             patch("app.cross.api.routes.auth_session.LOCAL_AUTH_ENABLED", True):
            with self.assertRaises(HTTPException):
                asyncio.run(local_login(LocalLogin(email="reader@example.com", password="Abcdef123456789!"), request))
        self.assertEqual(security_event.await_args.kwargs["event_type"], "rate_limit_blocked")
        self.assertEqual(security_event.await_args.kwargs["result"], "failure")

    def test_rejects_when_local_auth_is_disabled(self):
        request = _request(client_host="10.0.0.5", db=object())
        with patch("app.cross.api.routes.auth_session.LOCAL_AUTH_ENABLED", False):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(local_login(LocalLogin(email="reader@example.com", password="Abcdef1!"), request))
        self.assertEqual(error.exception.status_code, 404)

    def test_rate_limit_block_is_a_persisted_security_event(self):
        request = _request(client_host="10.0.0.9", db=object())
        with patch("app.cross.api.routes.auth_session.enforce_rate_limit", new=AsyncMock(side_effect=HTTPException(status_code=429, detail="too many"))), \
             patch("app.cross.api.routes.auth_session.record_security_event_for_request", new=AsyncMock()) as security_event, \
             patch("app.cross.api.routes.auth_session.LOCAL_AUTH_ENABLED", True):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(local_login(LocalLogin(email="reader@example.com", password="Abcdef123456789!"), request))
        self.assertEqual(error.exception.status_code, 429)
        self.assertEqual(security_event.await_args.kwargs["event_type"], "rate_limit_blocked")
        self.assertEqual(security_event.await_args.kwargs["result"], "failure")

    def test_login_transparently_rehashes_a_legacy_scrypt_hash_to_argon2id(self):
        """PENTEST-009: an account created before the Argon2id migration
        must be upgraded automatically on its next successful login,
        without the account owner noticing (no session/must_change_password
        side effect)."""
        request = _request(client_host="10.0.0.6", db=object())
        with patch("app.cross.services.local_authentication.find_local_user_for_login", new=AsyncMock(return_value=self._user_row(password_hash="scrypt$fakesalt$fakedigest"))), \
             patch("app.cross.services.local_authentication.verify_password_async", new=AsyncMock(return_value=True)), \
             patch("app.cross.services.local_authentication.rehash_password_async", new=AsyncMock(return_value="$argon2id$fresh$hash")) as rehash, \
             patch("app.cross.services.local_authentication.update_password_hash_after_rehash", new=AsyncMock()) as update_hash, \
             patch("app.cross.api.routes.auth_session.LOCAL_AUTH_ENABLED", True):
            result = asyncio.run(local_login(LocalLogin(email="reader@example.com", password="Abcdef123456789!"), request))

        self.assertTrue(result["authenticated"])
        rehash.assert_awaited_once_with("Abcdef123456789!")
        update_hash.assert_awaited_once_with(request.app.state.db, "reader-1", "$argon2id$fresh$hash")

    def test_login_does_not_rehash_an_already_current_argon2id_hash(self):
        from app.cross.services.password_hashing import hash_password

        current_hash = hash_password("Abcdef123456789!")  # a real, up-to-date Argon2id hash
        request = _request(client_host="10.0.0.7", db=object())
        with patch("app.cross.services.local_authentication.find_local_user_for_login", new=AsyncMock(return_value=self._user_row(password_hash=current_hash))), \
             patch("app.cross.services.local_authentication.verify_password_async", new=AsyncMock(return_value=True)), \
             patch("app.cross.services.local_authentication.rehash_password_async", new=AsyncMock()) as rehash, \
             patch("app.cross.services.local_authentication.update_password_hash_after_rehash", new=AsyncMock()) as update_hash, \
             patch("app.cross.api.routes.auth_session.LOCAL_AUTH_ENABLED", True):
            result = asyncio.run(local_login(LocalLogin(email="reader@example.com", password="Abcdef123456789!"), request))

        self.assertTrue(result["authenticated"])
        rehash.assert_not_awaited()
        update_hash.assert_not_awaited()

    def test_login_still_succeeds_if_the_transparent_rehash_fails(self):
        """Best-effort by design: a failure while upgrading the stored hash
        must never turn an already-successful, already-verified login into
        an error response."""
        request = _request(client_host="10.0.0.8", db=object())
        with patch("app.cross.services.local_authentication.find_local_user_for_login", new=AsyncMock(return_value=self._user_row(password_hash="scrypt$fakesalt$fakedigest"))), \
             patch("app.cross.services.local_authentication.verify_password_async", new=AsyncMock(return_value=True)), \
             patch("app.cross.services.local_authentication.rehash_password_async", new=AsyncMock(side_effect=RuntimeError("boom"))), \
             patch("app.cross.api.routes.auth_session.LOCAL_AUTH_ENABLED", True):
            result = asyncio.run(local_login(LocalLogin(email="reader@example.com", password="Abcdef123456789!"), request))

        self.assertTrue(result["authenticated"])


class RegisterFirstUserTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch("app.cross.api.routes.auth_bootstrap.enforce_rate_limit", new=AsyncMock(return_value=None)))
        self.enterContext(patch("app.cross.api.routes.auth_bootstrap.clear_rate_limit", new=AsyncMock(return_value=None)))

    def test_rejects_when_local_auth_is_disabled(self):
        request = _request()
        with patch("app.cross.api.routes.auth_bootstrap.LOCAL_AUTH_ENABLED", False), \
             patch("app.cross.api.routes.auth_bootstrap.SELF_REGISTER_SETUP_ENABLED", True):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(register_first_user(BootstrapRequest(email="admin@example.com", password="Abcdef1!", display_name="Admin"), request))
        self.assertEqual(error.exception.status_code, 404)

    def test_rejects_by_default_even_with_local_auth_enabled_and_no_users(self):
        """PENTEST-001: ALLOW_SELF_REGISTER_SETUP defaults to off, so
        whoever reaches the login page first can no longer self-provision
        the first admin with zero authentication -- the repository call
        that would actually create the user must never even be reached."""
        request = _request(db=object())
        with patch("app.cross.api.routes.auth_bootstrap.LOCAL_AUTH_ENABLED", True), \
             patch("app.cross.api.routes.auth_bootstrap.SELF_REGISTER_SETUP_ENABLED", False), \
             patch("app.cross.services.initial_admin.create_first_local_admin", new=AsyncMock(return_value=None)) as create:
            with self.assertRaises(HTTPException) as error:
                asyncio.run(register_first_user(BootstrapRequest(email="admin@example.com", password="Abcdef1!", display_name="Admin"), request))
        self.assertEqual(error.exception.status_code, 404)
        create.assert_not_awaited()

    def test_maps_first_user_already_exists_to_409(self):
        request = _request(db=object())
        with patch("app.cross.api.routes.auth_bootstrap.LOCAL_AUTH_ENABLED", True), \
             patch("app.cross.api.routes.auth_bootstrap.SELF_REGISTER_SETUP_ENABLED", True), \
             patch("app.cross.services.initial_admin.create_first_local_admin", new=AsyncMock(side_effect=FirstUserAlreadyExists("ya existe"))):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(register_first_user(BootstrapRequest(email="admin@example.com", password="Abcdef123456789!", display_name="Admin"), request))
        self.assertEqual(error.exception.status_code, 409)

    def test_creates_the_first_admin_and_clears_the_session(self):
        request = _request(db=object())
        request.session = {"stale": True}
        with patch("app.cross.api.routes.auth_bootstrap.LOCAL_AUTH_ENABLED", True), \
             patch("app.cross.api.routes.auth_bootstrap.SELF_REGISTER_SETUP_ENABLED", True), \
             patch("app.cross.services.initial_admin.create_first_local_admin", new=AsyncMock(return_value=None)) as create, \
             patch("app.cross.api.routes.auth_bootstrap.record_security_event_for_request", new=AsyncMock()) as security_event:
            result = asyncio.run(register_first_user(
                BootstrapRequest(email="Admin@Example.com", password="Abcdef123456789!", display_name="Admin"), request,
            ))
        self.assertEqual(result["actor_id"], "admin@example.com")
        create.assert_awaited_once()
        self.assertEqual(create.await_args.args[1], "admin@example.com")
        self.assertEqual(request.session, {})
        # PENTEST-008: self-registering the first admin is a persisted
        # security event.
        self.assertEqual(security_event.await_args.kwargs["event_type"], "self_register_created")
        self.assertEqual(security_event.await_args.kwargs["result"], "success")
        self.assertEqual(security_event.await_args.kwargs["actor_id"], "admin@example.com")


class BootstrapTokenTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch("app.cross.api.routes.auth_bootstrap.enforce_rate_limit", new=AsyncMock(return_value=None)))
        self.enterContext(patch("app.cross.api.routes.auth_bootstrap.clear_rate_limit", new=AsyncMock(return_value=None)))

    def test_rejects_without_a_valid_bootstrap_token(self):
        request = _request(db=object())
        request.headers = {"X-Bootstrap-Token": "wrong"}
        with patch.dict("os.environ", {"AUTH_BOOTSTRAP_TOKEN": "expected"}, clear=False), \
             patch("app.cross.api.routes.auth_bootstrap.LOCAL_AUTH_ENABLED", True), \
             patch("app.cross.api.routes.auth_bootstrap.record_security_event_for_request", new=AsyncMock()) as security_event:
            with self.assertRaises(HTTPException) as error:
                asyncio.run(bootstrap(BootstrapRequest(email="admin@example.com", password="Abcdef1!", display_name="Admin"), request))
        self.assertEqual(error.exception.status_code, 403)
        # PENTEST-008: a rejected bootstrap token is a persisted security event.
        self.assertEqual(security_event.await_args.kwargs["event_type"], "technical_token_rejected")
        self.assertEqual(security_event.await_args.kwargs["result"], "failure")
        self.assertEqual(security_event.await_args.kwargs["event_type"], "technical_token_rejected")

    def test_rejects_once_an_administrator_already_exists(self):
        request = _request(db=object())
        request.headers = {"X-Bootstrap-Token": "expected"}
        with patch.dict("os.environ", {"AUTH_BOOTSTRAP_TOKEN": "expected"}, clear=False), \
             patch("app.cross.api.routes.auth_bootstrap.LOCAL_AUTH_ENABLED", True), \
             patch("app.cross.services.initial_admin.count_local_users", new=AsyncMock(return_value=1)):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(bootstrap(BootstrapRequest(email="admin@example.com", password="Abcdef1!", display_name="Admin"), request))
        self.assertEqual(error.exception.status_code, 409)

    def test_creates_the_administrator(self):
        request = _request(db=object())
        request.headers = {"X-Bootstrap-Token": "expected"}
        with patch.dict("os.environ", {"AUTH_BOOTSTRAP_TOKEN": "expected"}, clear=False), \
             patch("app.cross.api.routes.auth_bootstrap.LOCAL_AUTH_ENABLED", True), \
             patch("app.cross.services.initial_admin.count_local_users", new=AsyncMock(return_value=0)), \
             patch("app.cross.services.initial_admin.create_bootstrap_admin", new=AsyncMock(return_value=None)) as create, \
             patch("app.cross.api.routes.auth_bootstrap.record_security_event_for_request", new=AsyncMock()) as security_event:
            result = asyncio.run(bootstrap(BootstrapRequest(email="admin@example.com", password="Abcdef123456789!", display_name="Admin"), request))
        self.assertEqual(result["actor_id"], "admin@example.com")
        create.assert_awaited_once()
        # PENTEST-008: creating the bootstrap admin is a persisted security event.
        self.assertEqual(security_event.await_args.kwargs["event_type"], "bootstrap_admin_created")
        self.assertEqual(security_event.await_args.kwargs["result"], "success")
        self.assertEqual(security_event.await_args.kwargs["actor_id"], "admin@example.com")
        self.assertEqual(security_event.await_args.kwargs["event_type"], "bootstrap_admin_created")


if __name__ == "__main__":
    unittest.main()
