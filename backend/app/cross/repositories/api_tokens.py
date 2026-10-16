"""Persistence for user-issued, opaque, read-only API tokens."""

from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from app.db import fetch_all, fetch_one
from app.cross.repositories.audit import record_audit


MAX_ACTIVE_API_TOKENS = 10


class TooManyActiveApiTokens(ValueError):
    """Raised when an actor must revoke a token before creating another."""


async def create_api_token(
    pool: Any,
    *,
    actor_id: str,
    auth_source: str,
    session_version: int | None,
    label: str,
    token_digest: str,
    expires_at: datetime,
) -> dict:
    token_id = uuid4()
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                await cursor.execute(
                    "SELECT pg_advisory_xact_lock(hashtext(%s))",
                    (f"dshub-api-token:{actor_id}",),
                )
                await cursor.execute(
                    """SELECT count(*)::int AS count
                       FROM public.access_api_tokens
                       WHERE actor_id = %s AND revoked_at IS NULL AND expires_at > now()""",
                    (actor_id,),
                )
                active = await cursor.fetchone()
                if active and active["count"] >= MAX_ACTIVE_API_TOKENS:
                    raise TooManyActiveApiTokens(
                        f"Se permiten hasta {MAX_ACTIVE_API_TOKENS} tokens activos por usuario"
                    )
                await cursor.execute(
                    """INSERT INTO public.access_api_tokens
                         (token_id, actor_id, auth_source, session_version, label, token_hash, expires_at)
                       VALUES (%s, %s, %s, %s, %s, %s, %s)
                       RETURNING token_id, label, created_at, expires_at""",
                    (
                        token_id,
                        actor_id,
                        auth_source,
                        session_version,
                        label,
                        token_digest,
                        expires_at,
                    ),
                )
                created = await cursor.fetchone()
            await record_audit(
                pool,
                connection=conn,
                actor_id=actor_id,
                action="create",
                entity_type="api_token",
                entity_id=str(token_id),
                after_data={"label": label, "expires_at": expires_at.isoformat(), "scope": "read"},
            )
    return created


async def resolve_api_token(pool: Any, token_digest: str) -> dict | None:
    """Resolve a valid token without ever loading its plaintext.

    Local tokens are invalidated by account deactivation or a session-version
    bump. OIDC actors do not have a local user row, so their short-lived token
    remains valid only while at least one current role assignment exists.
    Permissions themselves are still evaluated live by the caller.
    """
    return await fetch_one(
        pool,
        """SELECT token.actor_id, token.auth_source, token.token_id, token.expires_at
           FROM public.access_api_tokens token
           LEFT JOIN public.access_users local_user ON local_user.actor_id = token.actor_id
           WHERE token.token_hash = %s
             AND token.revoked_at IS NULL
             AND token.expires_at > now()
             AND (
               (
                 token.auth_source = 'local'
                 AND local_user.is_active IS TRUE
                 AND local_user.session_version = token.session_version
               )
               OR (
                 token.auth_source = 'oidc'
                 AND EXISTS (
                   SELECT 1 FROM public.access_user_roles oidc_role
                   WHERE oidc_role.actor_id = token.actor_id
                 )
               )
             )""",
        (token_digest,),
    )


async def list_api_tokens(pool: Any, actor_id: str) -> list[dict]:
    return await fetch_all(
        pool,
        """SELECT token_id, label, auth_source, created_at, expires_at, revoked_at,
                  CASE
                    WHEN revoked_at IS NOT NULL THEN 'revoked'
                    WHEN expires_at <= now() THEN 'expired'
                    ELSE 'active'
                  END AS status
           FROM public.access_api_tokens
           WHERE actor_id = %s
           ORDER BY created_at DESC, token_id DESC
           LIMIT 100""",
        (actor_id,),
    )


async def revoke_api_token(pool: Any, actor_id: str, token_id: UUID) -> bool:
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                await cursor.execute(
                    """UPDATE public.access_api_tokens
                       SET revoked_at = now()
                       WHERE token_id = %s AND actor_id = %s AND revoked_at IS NULL
                       RETURNING token_id, label, expires_at""",
                    (token_id, actor_id),
                )
                revoked = await cursor.fetchone()
            if revoked is None:
                return False
            await record_audit(
                pool,
                connection=conn,
                actor_id=actor_id,
                action="revoke",
                entity_type="api_token",
                entity_id=str(token_id),
                before_data={
                    "label": revoked["label"],
                    "expires_at": revoked["expires_at"].isoformat(),
                    "scope": "read",
                },
            )
    return True
