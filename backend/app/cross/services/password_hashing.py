import asyncio
import base64
from concurrent.futures import Future, ThreadPoolExecutor
from functools import partial
import hashlib
import hmac
import os

from argon2 import PasswordHasher
from argon2 import exceptions as argon2_exceptions
from argon2.low_level import Type as Argon2Type

# PENTEST-006: hashlib.scrypt()'s cost scales with the *parameters* (n/r/p),
# not with input length, but there is still no reason to let a caller feed
# it an arbitrarily large string before rejecting it on policy grounds --
# and this bounds it centrally, ahead of every hash_password() call site
# (some of which, e.g. UserUpdate.password, currently declare no
# max_length of their own at the API schema layer).
MAX_PASSWORD_LENGTH = 128
KDF_MAX_CONCURRENCY = 4
_KDF_EXECUTOR = ThreadPoolExecutor(max_workers=KDF_MAX_CONCURRENCY, thread_name_prefix="custodia-kdf")

# PENTEST-009: NIST SP 800-63B recommends a longer minimum instead of
# composition rules for single-factor passwords, and discourages forcing
# uppercase/lowercase/digit/special-character composition (it pushes users
# toward predictable patterns like "Password1!" without meaningfully
# increasing entropy). This only ever applies at password *creation/change*
# (validate_password is called exclusively from hash_password/
# hash_password_async, never from the login/verify path) -- an existing
# account with a shorter password keeps working until its next password
# change, it is never forced to reset.
MIN_PASSWORD_LENGTH = 15

# OWASP-recommended Argon2id parameters (first configuration option from the
# OWASP Password Storage Cheat Sheet: m=19 MiB, t=2, p=1, 32-byte output).
_ARGON2_HASHER = PasswordHasher(
    time_cost=2,
    memory_cost=19 * 1024,
    parallelism=1,
    hash_len=32,
    salt_len=16,
    type=Argon2Type.ID,
)

_BLOCKLIST_PATH = os.path.join(os.path.dirname(__file__), "common_passwords_blocklist.txt")


def _load_blocklist() -> frozenset[str]:
    """PENTEST-009: a static, local, offline blocklist of the most common
    breached/predictable passwords -- deliberately not a live call to an
    external service like HaveIBeenPwned (no such integration exists in
    this repo, and adding a network dependency to every password
    creation/change request is its own availability/latency risk). Only
    catches passwords in this list verbatim (case-insensitive); it isn't a
    substitute for length + a real KDF, just one more cheap layer."""
    try:
        with open(_BLOCKLIST_PATH, encoding="utf-8") as handle:
            return frozenset(line.strip().casefold() for line in handle if line.strip() and not line.startswith("#"))
    except FileNotFoundError:
        return frozenset()


_COMMON_PASSWORDS_BLOCKLIST = _load_blocklist()


def validate_password(password: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"La contraseña debe tener al menos {MIN_PASSWORD_LENGTH} caracteres")
    if len(password) > MAX_PASSWORD_LENGTH:
        raise ValueError(f"La contraseña no puede superar los {MAX_PASSWORD_LENGTH} caracteres")
    if password.casefold() in _COMMON_PASSWORDS_BLOCKLIST:
        raise ValueError("Esta contraseña es demasiado común o fue filtrada en brechas conocidas; elegí otra")


def _hash_argon2id(password: str) -> str:
    """Raw Argon2id hash with no policy check -- used both by hash_password
    (after validate_password already ran) and by the transparent rehash
    path (which must never re-reject an already-accepted legacy password
    against the new, stricter policy; PENTEST-009 explicitly scopes the new
    rules to creation/change only)."""
    return _ARGON2_HASHER.hash(password)


def hash_password(password: str) -> str:
    validate_password(password)
    return _hash_argon2id(password)


def rehash_password(password: str) -> str:
    """Same primitive as hash_password, without validate_password. Used only
    to transparently upgrade an already-verified legacy (scrypt) hash to
    Argon2id on successful login -- the plaintext already matched the
    account's stored credential, so re-running the *new* creation-time
    policy against it here would incorrectly reject long-standing
    passwords that predate PENTEST-009 purely because of this migration."""
    return _hash_argon2id(password)


def needs_rehash(encoded_hash: str) -> bool:
    """True for every legacy scrypt hash (always upgrade opportunistically)
    and for any Argon2id hash whose parameters have drifted from the
    current OWASP-recommended configuration."""
    if encoded_hash.startswith("scrypt$"):
        return True
    if encoded_hash.startswith("$argon2"):
        try:
            return _ARGON2_HASHER.check_needs_rehash(encoded_hash)
        except argon2_exceptions.InvalidHash:
            return False
    return False


def _verify_scrypt(password: str, encoded_hash: str) -> bool:
    try:
        scheme, salt_encoded, digest_encoded = encoded_hash.split("$", 2)
        if scheme != "scrypt":
            return False
        salt = base64.urlsafe_b64decode(salt_encoded.encode("ascii"))
        expected = base64.urlsafe_b64decode(digest_encoded.encode("ascii"))
        actual = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1, dklen=len(expected))
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError, UnicodeError):
        return False


def verify_password(password: str, encoded_hash: str) -> bool:
    """Verifies against either scheme this repository has ever produced:
    legacy scrypt$<salt>$<digest> (PENTEST-006 and earlier) or Argon2id's
    own self-describing $argon2id$... encoding (PENTEST-009). Never calls
    validate_password -- the login path must keep accepting whatever
    password an account was created/changed with under the policy in
    force *at that time*."""
    if encoded_hash.startswith("scrypt$"):
        return _verify_scrypt(password, encoded_hash)
    if encoded_hash.startswith("$argon2"):
        try:
            return _ARGON2_HASHER.verify(encoded_hash, password)
        except argon2_exceptions.VerifyMismatchError:
            return False
        except argon2_exceptions.VerificationError:
            return False
        except argon2_exceptions.InvalidHash:
            return False
    return False


async def _run_in_kdf_executor(function, *args):
    """Run a KDF operation without relying on executor callback wakeups.

    Python 3.14's default asyncio loop can execute a ThreadPoolExecutor
    worker but fail to deliver the worker's completion callback back to the
    loop, leaving ``run_in_executor`` awaiters pending forever. Polling the
    thread-safe concurrent Future keeps the loop responsive and works on
    older runtimes as well. Submission still goes through the shared bounded
    pool, so concurrent KDF memory use remains capped.
    """
    future: Future = _KDF_EXECUTOR.submit(function, *args)
    try:
        while not future.done():
            await asyncio.sleep(0.001)
        return future.result()
    except asyncio.CancelledError:
        # A running KDF cannot be interrupted safely. Cancel queued work;
        # the bounded executor will finish any work already in progress.
        future.cancel()
        raise


async def hash_password_async(password: str) -> str:
    """PENTEST-006: hashlib.scrypt() is deliberately slow (that's the whole
    point of a KDF) and runs synchronously; called directly from an async
    endpoint, it blocks the single event loop for its full duration,
    serializing every other concurrent request behind it. This offloads the
    call to a dedicated, bounded worker pool so a burst neither stalls
    unrelated traffic nor starts too many memory-intensive KDFs at once.
    hash_password itself remains synchronous for scripts and tests.

    PENTEST-009: now produces Argon2id, which is deliberately even more
    expensive (both CPU and ~19 MiB of memory per call) than scrypt was --
    the same bounded executor keeps a burst of concurrent hashes from
    exhausting process memory."""
    return await _run_in_kdf_executor(hash_password, password)


async def rehash_password_async(password: str) -> str:
    """Async counterpart of rehash_password; see its docstring."""
    return await _run_in_kdf_executor(rehash_password, password)


async def verify_password_async(password: str, encoded_hash: str) -> bool:
    """Async counterpart of hash_password_async; see its docstring."""
    return await _run_in_kdf_executor(partial(verify_password, password, encoded_hash))
