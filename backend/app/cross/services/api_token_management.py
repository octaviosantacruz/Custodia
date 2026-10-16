"""Personal API token use cases (ARCH-LAYERS-002).

The route decides who may issue (session inspection) and records the security
event; this service generates the opaque value, computes the expiry, persists
only the digest and enforces the active-token cap. The plaintext is returned
once and never stored.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

from psycopg_pool import AsyncConnectionPool

from app.cross.repositories.api_tokens import (
    TooManyActiveApiTokens,
    create_api_token,
    list_api_tokens,
    revoke_api_token,
)
from app.cross.services.api_tokens import digest_api_token, generate_api_token

__all__ = ["TooManyActiveApiTokens", "issue_personal_token", "list_personal_tokens", "revoke_personal_token"]


async def issue_personal_token(
    pool: AsyncConnectionPool,
    *,
    actor_id: str,
    auth_source: str,
    session_version: int | None,
    label: str,
    expires_in_minutes: int,
) -> tuple[dict, str]:
    """Create a read-only token; returns ``(stored_metadata, plaintext)``."""
    plaintext = generate_api_token()
    created = await create_api_token(
        pool,
        actor_id=actor_id,
        auth_source=auth_source,
        session_version=session_version,
        label=label,
        token_digest=digest_api_token(plaintext),
        expires_at=datetime.now(UTC) + timedelta(minutes=expires_in_minutes),
    )
    return created, plaintext


async def list_personal_tokens(pool: AsyncConnectionPool, actor_id: str) -> list[dict]:
    return await list_api_tokens(pool, actor_id)


async def revoke_personal_token(pool: AsyncConnectionPool, actor_id: str, token_id: UUID) -> bool:
    return await revoke_api_token(pool, actor_id, token_id)
