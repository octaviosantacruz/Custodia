"""Pure primitives for opaque, read-only Custodia API tokens."""

import hashlib
import secrets


API_TOKEN_PREFIX = "dsh_pat_"


def generate_api_token() -> str:
    """Return a high-entropy token whose plaintext is shown only once."""
    return API_TOKEN_PREFIX + secrets.token_urlsafe(32)


def digest_api_token(token: str) -> str:
    """One-way lookup value persisted by the repository."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
