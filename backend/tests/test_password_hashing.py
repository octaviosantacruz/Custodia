"""PENTEST-006: password hashing runs off the event loop, and inputs are
bounded before ever reaching hashlib.scrypt()."""

import asyncio
import threading
import time
import unittest
from unittest.mock import patch

from pydantic import ValidationError

from app.api.routes.auth_models import LocalLogin, PasswordChange
from app.services.password_hashing import (
    KDF_MAX_CONCURRENCY,
    MAX_PASSWORD_LENGTH,
    MIN_PASSWORD_LENGTH,
    hash_password,
    hash_password_async,
    needs_rehash,
    rehash_password,
    rehash_password_async,
    validate_password,
    verify_password,
    verify_password_async,
)


class PasswordLengthPolicyTests(unittest.TestCase):
    def test_validate_password_rejects_a_password_longer_than_the_maximum(self):
        too_long = "Ab1!" + "x" * (MAX_PASSWORD_LENGTH)  # well past the limit
        with self.assertRaises(ValueError):
            validate_password(too_long)

    def test_validate_password_accepts_a_password_at_exactly_the_maximum(self):
        at_limit = "Ab1!" + "x" * (MAX_PASSWORD_LENGTH - 4)
        self.assertEqual(len(at_limit), MAX_PASSWORD_LENGTH)
        validate_password(at_limit)  # must not raise

    def test_hash_password_rejects_an_oversized_password_before_hashing(self):
        with self.assertRaises(ValueError):
            hash_password("Ab1!" + "x" * 10_000)

    def test_validate_password_rejects_a_password_shorter_than_the_new_minimum(self):
        # Project minimum applies to new passwords.
        too_short = "x" * (MIN_PASSWORD_LENGTH - 1)
        with self.assertRaises(ValueError):
            validate_password(too_short)

    def test_validate_password_accepts_a_password_at_exactly_the_new_minimum(self):
        at_minimum = "a" * (MIN_PASSWORD_LENGTH - 2) + "1!"
        self.assertEqual(len(at_minimum), MIN_PASSWORD_LENGTH)
        validate_password(at_minimum)  # must not raise

    def test_composition_and_unicode_match_the_frontend_policy(self):
        for value in ("abcdefghijk!", "abcdefghijk1", "abcdefghij1 ", "abcdefghij١!", "a" * 10 + "1!"):
            with self.subTest(value=value):
                if value == "a" * 10 + "1!":
                    validate_password(value)
                else:
                    with self.assertRaises(ValueError):
                        validate_password(value)
        validate_password("a" * 10 + "1€")
        validate_password("a" * 10 + "1😀")
        with self.assertRaises(ValueError):
            validate_password("a" * 9 + "1😀")

    def test_validate_password_rejects_a_common_blocklisted_password(self):
        with self.assertRaises(ValueError):
            validate_password("correcthorsebattery")
        with self.assertRaises(ValueError):
            validate_password("1qaz2wsx3edc4rfv")

    def test_validate_password_blocklist_check_is_case_insensitive(self):
        with self.assertRaises(ValueError):
            validate_password("CorrectHorseBattery")


class LoginAndPasswordChangeSchemaLengthTests(unittest.TestCase):
    """The login route never calls validate_password() (that only applies
    to *new* passwords), so LocalLogin/PasswordChange need their own bound
    -- otherwise an oversized login/current-password string would still
    reach verify_password() -> hashlib.scrypt() before any policy check."""

    def test_login_rejects_an_oversized_password_before_it_ever_reaches_verify_password(self):
        with self.assertRaises(ValidationError):
            LocalLogin(email="user@example.test", password="x" * 10_000)

    def test_login_rejects_an_oversized_email(self):
        with self.assertRaises(ValidationError):
            LocalLogin(email="a" * 10_000 + "@example.test", password="Sample123456789!")

    def test_login_accepts_ordinary_credentials(self):
        LocalLogin(email="user@example.test", password="Sample123456789!")  # must not raise

    def test_login_rejects_a_malformed_email_before_it_ever_reaches_the_rate_limiter(self):
        """IF-001: a syntactically invalid string used to reach
        verify_password() (and the rate limiter's bucket_key) unchanged,
        letting an unauthenticated caller mint an unbounded number of
        distinct buckets from garbage that could never match a real
        account. Rejected at the schema layer, before any lookup or
        rate-limit reservation."""
        with self.assertRaises(ValidationError):
            LocalLogin(email="not-an-email", password="Sample123456789!")
        with self.assertRaises(ValidationError):
            LocalLogin(email="", password="Sample123456789!")

    def test_password_change_rejects_an_oversized_current_password(self):
        with self.assertRaises(ValidationError):
            PasswordChange(current_password="x" * 10_000, new_password="Sample123456789!")


class PasswordHashingDoesNotBlockTheEventLoopTests(unittest.IsolatedAsyncioTestCase):
    """Proves hash_password_async/verify_password_async actually hand the
    CPU-bound scrypt call off to a worker thread instead of running it
    inline on the event loop -- the concrete bug PENTEST-006 flagged
    (a burst of concurrent logins serializing behind each other and
    starving unrelated requests)."""

    async def test_hashing_calls_run_outside_the_event_loop_thread(self):
        thread_ids: set[int] = set()
        lock = threading.Lock()

        def recording_hash_password(password: str) -> str:
            with lock:
                thread_ids.add(threading.get_ident())
            return "scrypt$fake$fake"

        import app.services.password_hashing as password_hashing_module
        with patch.object(password_hashing_module, "hash_password", side_effect=recording_hash_password):
            await asyncio.gather(*(hash_password_async("Sample123456789!") for _ in range(4)))

        # asyncio.to_thread uses the default executor's worker threads, never
        # the event loop's own thread -- if this ran inline instead, every
        # call would report the same thread id as the test itself.
        self.assertNotIn(threading.get_ident(), thread_ids)

    async def test_kdf_executor_bounds_parallel_work(self):
        import app.services.password_hashing as password_hashing_module

        active = 0
        peak = 0
        lock = threading.Lock()

        def measured_hash(_password: str) -> str:
            nonlocal active, peak
            with lock:
                active += 1
                peak = max(peak, active)
            time.sleep(0.05)
            with lock:
                active -= 1
            return "scrypt$fake$fake"

        with patch.object(password_hashing_module, "hash_password", side_effect=measured_hash):
            await asyncio.gather(*(hash_password_async("Sample123456789!") for _ in range(KDF_MAX_CONCURRENCY * 3)))

        self.assertLessEqual(peak, KDF_MAX_CONCURRENCY)

    async def test_a_slow_hash_does_not_block_an_unrelated_concurrent_coroutine(self):
        import app.services.password_hashing as password_hashing_module

        def slow_hash(password: str) -> str:
            time.sleep(0.2)
            hash_finished.append(time.monotonic())
            return "scrypt$fake$fake"

        hash_finished: list[float] = []
        unrelated_ticks: list[float] = []

        async def tick_every_10ms():
            for _ in range(10):
                unrelated_ticks.append(time.monotonic())
                await asyncio.sleep(0.01)

        with patch.object(password_hashing_module, "hash_password", side_effect=slow_hash):
            await asyncio.gather(hash_password_async("Sample123456789!"), tick_every_10ms())

        # Avoid a wall-clock threshold, which is flaky on a busy CI runner.
        # If slow_hash ran inline, it would finish before the event loop could
        # execute the ticker even once. In a worker, the ticker starts while
        # the simulated KDF is still running.
        self.assertLess(unrelated_ticks[0], hash_finished[0])

    async def test_hash_and_verify_async_round_trip(self):
        encoded = await hash_password_async("Sample123456789!")
        self.assertTrue(await verify_password_async("Sample123456789!", encoded))
        self.assertFalse(await verify_password_async("wrong-password", encoded))
        # Sanity: the async wrapper produces/reads the exact same format the
        # synchronous functions do.
        self.assertTrue(verify_password("Sample123456789!", encoded))


class PasswordHashingTerminatesUnderTheDefaultEventLoopTests(unittest.IsolatedAsyncioTestCase):
    """IF-005: a cross-review flagged that hashlib.scrypt(), run through
    _KDF_EXECUTOR's ThreadPoolExecutor, can hang indefinitely on some
    Python/event-loop combinations instead of ever returning to the caller
    (observed as a bootstrap test not finishing within 45s on a runtime
    without uvloop installed). unittest.IsolatedAsyncioTestCase runs on
    asyncio's own default event loop (never uvloop, regardless of what any
    other module may have installed globally), so this reproduces that
    exact combination. A hard timeout means a regression here fails fast
    with a clear timeout error instead of hanging the whole suite."""

    async def test_hash_password_async_completes_within_a_bounded_timeout(self):
        encoded = await asyncio.wait_for(hash_password_async("Sample123456789!"), timeout=5)
        self.assertTrue(encoded.startswith("$argon2id$"))

    async def test_verify_password_async_completes_within_a_bounded_timeout(self):
        encoded = hash_password("Sample123456789!")
        result = await asyncio.wait_for(verify_password_async("Sample123456789!", encoded), timeout=5)
        self.assertTrue(result)

    async def test_a_burst_of_concurrent_hashes_completes_within_a_bounded_timeout(self):
        # KDF_MAX_CONCURRENCY=4 workers, twice that many calls: proves the
        # queueing behind a full worker pool still terminates, it doesn't
        # deadlock the pool or the loop.
        await asyncio.wait_for(
            asyncio.gather(*(hash_password_async("Sample123456789!") for _ in range(KDF_MAX_CONCURRENCY * 2))),
            timeout=10,
        )


class Argon2idMigrationTests(unittest.TestCase):
    """PENTEST-009: hash_password() now produces Argon2id, but verify_password
    must keep accepting every scrypt$... hash this app has ever produced
    (PENTEST-006 and earlier) -- there is no forced reset, existing
    accounts keep working through their legacy hash until their next
    successful login triggers a transparent rehash."""

    def _legacy_scrypt_hash(self, password: str) -> str:
        import base64
        import hashlib
        import os as _os

        salt = _os.urandom(16)
        digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1, dklen=32)
        return "scrypt$" + base64.urlsafe_b64encode(salt).decode("ascii") + "$" + base64.urlsafe_b64encode(digest).decode("ascii")

    def test_verify_password_still_accepts_a_legacy_scrypt_hash(self):
        legacy_hash = self._legacy_scrypt_hash("Sample123456789!")
        self.assertTrue(verify_password("Sample123456789!", legacy_hash))
        self.assertFalse(verify_password("wrong-password-here", legacy_hash))

    def test_verify_password_accepts_a_fresh_argon2id_hash(self):
        encoded = hash_password("Sample123456789!")
        self.assertTrue(verify_password("Sample123456789!", encoded))
        self.assertFalse(verify_password("wrong-password-here", encoded))

    def test_needs_rehash_is_true_for_every_legacy_scrypt_hash(self):
        self.assertTrue(needs_rehash(self._legacy_scrypt_hash("Sample123456789!")))

    def test_needs_rehash_is_false_for_a_fresh_argon2id_hash(self):
        self.assertFalse(needs_rehash(hash_password("Sample123456789!")))

    def test_needs_rehash_is_false_for_an_unrecognized_string(self):
        # Defensive default: an unparseable hash can't be rehashed blindly
        # here (the caller already failed to verify it, so this path only
        # matters after a successful verify elsewhere in the real flow).
        self.assertFalse(needs_rehash("not-a-real-hash"))

    def test_rehash_password_does_not_enforce_the_creation_time_policy(self):
        # PENTEST-009 explicitly scopes the new length/blocklist rules to
        # creation/change -- an existing 8-character password that predates
        # this migration must still be rehashable to Argon2id on login,
        # not rejected by validate_password's current minimum.
        short_legacy_password = "Ab1!xyz9"  # 8 chars, would fail validate_password today
        with self.assertRaises(ValueError):
            validate_password(short_legacy_password)
        rehashed = rehash_password(short_legacy_password)  # must not raise
        self.assertTrue(rehashed.startswith("$argon2id$"))
        self.assertTrue(verify_password(short_legacy_password, rehashed))


class Argon2idMigrationAsyncTests(unittest.IsolatedAsyncioTestCase):
    async def test_rehash_password_async_round_trip(self):
        rehashed = await rehash_password_async("Sample123456789!")
        self.assertTrue(await verify_password_async("Sample123456789!", rehashed))


if __name__ == "__main__":
    unittest.main()
