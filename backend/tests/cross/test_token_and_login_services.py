import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

from app.cross.services import api_token_management as tokens
from app.cross.services import local_authentication as login


class ApiTokenManagementTests(unittest.IsolatedAsyncioTestCase):
    async def test_only_the_digest_is_persisted_and_plaintext_returned_once(self):
        create = AsyncMock(return_value={"token_id": "t"})
        with patch.object(tokens, "generate_api_token", return_value="dsh_pat_secret"), \
             patch.object(tokens, "create_api_token", new=create):
            before = datetime.now(UTC)
            created, plaintext = await tokens.issue_personal_token(
                object(), actor_id="a@x.com", auth_source="local", session_version=3, label="ci", expires_in_minutes=60,
            )
        self.assertEqual(plaintext, "dsh_pat_secret")
        kwargs = create.await_args.kwargs
        self.assertNotIn("dsh_pat_secret", kwargs.values())
        self.assertEqual(kwargs["token_digest"], tokens.digest_api_token("dsh_pat_secret"))
        self.assertGreaterEqual(kwargs["expires_at"], before + timedelta(minutes=59))
        self.assertEqual((kwargs["auth_source"], kwargs["session_version"]), ("local", 3))
        self.assertEqual(created, {"token_id": "t"})

    async def test_active_token_cap_propagates(self):
        with patch.object(tokens, "create_api_token", new=AsyncMock(side_effect=tokens.TooManyActiveApiTokens("cap"))):
            with self.assertRaises(tokens.TooManyActiveApiTokens):
                await tokens.issue_personal_token(
                    object(), actor_id="a", auth_source="oidc", session_version=None, label="x", expires_in_minutes=5,
                )


class LocalAuthenticationTests(unittest.IsolatedAsyncioTestCase):
    def _user(self, **extra):
        return {
            "actor_id": "a@x.com", "display_name": "A", "email": "a@x.com", "roles": None, "role_names": None,
            "must_change_password": 1, "session_version": 4, "password_hash": "h", **extra,
        }

    async def test_unknown_user_and_wrong_password_are_the_same_outcome(self):
        with patch.object(login, "find_local_user_for_login", new=AsyncMock(return_value=None)):
            self.assertIsNone(await login.authenticate_local_user(object(), " a@x.com ", "pw"))
        with patch.object(login, "find_local_user_for_login", new=AsyncMock(return_value=self._user())), \
             patch.object(login, "verify_password_async", new=AsyncMock(return_value=False)):
            self.assertIsNone(await login.authenticate_local_user(object(), "a@x.com", "bad"))

    async def test_email_is_stripped_before_lookup(self):
        find = AsyncMock(return_value=None)
        with patch.object(login, "find_local_user_for_login", new=find):
            await login.authenticate_local_user("pool", "  a@x.com ", "pw")
        find.assert_awaited_once_with("pool", "a@x.com")

    async def test_rehash_failure_never_raises(self):
        with patch.object(login, "needs_rehash", return_value=True), \
             patch.object(login, "rehash_password_async", new=AsyncMock(side_effect=RuntimeError("boom"))), \
             self.assertLogs(login.LOGGER, level="WARNING"):
            await login.upgrade_password_hash_if_needed(object(), self._user(), "pw")

    async def test_current_hash_is_left_alone(self):
        update = AsyncMock()
        with patch.object(login, "needs_rehash", return_value=False), patch.object(login, "update_password_hash_after_rehash", new=update):
            await login.upgrade_password_hash_if_needed(object(), self._user(), "pw")
        update.assert_not_awaited()

    def test_session_payload_never_carries_the_hash(self):
        payload = login.local_session_payload(self._user())
        self.assertNotIn("password_hash", payload)
        self.assertEqual(payload["roles"], [])
        self.assertIs(payload["must_change_password"], True)
        self.assertEqual(payload["auth_source"], "local")


if __name__ == "__main__":
    unittest.main()
