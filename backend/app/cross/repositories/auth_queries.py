"""Data access for the authentication/session flow: local login, the
one-time bootstrap/self-registration paths, and OIDC role sync.

Extracted from app/auth.py and the auth route modules, which used to run
raw SQL directly instead of going through the repository layer like every
other part of the app. Behavior is unchanged; only the location moved.

Deliberately a separate module from repositories/access_control.py, which
owns the role/permission *catalog* (list/create/update roles and
permissions for the admin UI) -- this module is about authenticating and
resolving one actor's own roles, a different concern even though both
touch the same access_users/access_user_roles tables.

See backend/tests/test_access_control_queries.py and
backend/tests/cross/test_oidc_role_refresh.py for the regression coverage that
was written before this move.
"""
from __future__ import annotations

from typing import Any

from psycopg.types.json import Jsonb

from app.db import fetch_all, fetch_one
from app.cross.repositories.audit import record_audit


class FirstUserAlreadyExists(ValueError):
    """Raised when self-registration is attempted after an account already exists."""


async def get_actor_permissions(pool: Any, actor_id: str) -> list[str]:
    rows = await fetch_all(
        pool,
        """SELECT DISTINCT arp.permission_code
           FROM public.access_user_roles aur
           JOIN public.access_effective_role_permissions arp ON arp.role_code = aur.role_code
           LEFT JOIN public.access_users u ON u.actor_id = aur.actor_id
           WHERE aur.actor_id = %s AND (u.actor_id IS NULL OR u.is_active = true)
           ORDER BY arp.permission_code""",
        (actor_id,),
    )
    return [row["permission_code"] for row in rows]


async def sync_oidc_role_assignments(
    pool: Any, actor_id: str, roles: list[str], *, issuer: str, email: str, display_name: str,
    mapped_groups: list[str] | None = None,
    role_groups: dict[str, list[str]] | None = None,
) -> None:
    """Replace the roles this actor's OIDC groups grant with the claims just observed.

    Full replace (delete then insert), not a diff: OIDC claims are the
    single source of truth for the 'oidc' assignments, so a role removed
    upstream must not linger locally. ACCESS-UI-001: a role assigned in Custodia
    ('manual') is a human decision and survives every login; when the groups
    also grant it, the manual row is kept as is.
    """
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                # A local password account and an OIDC subject must never
                # acquire one another's grants through an actor_id collision.
                await cursor.execute("SELECT 1 FROM public.access_users WHERE actor_id = %s", (actor_id,))
                if await cursor.fetchone():
                    raise ValueError("La identidad OIDC coincide con un usuario local")
                await cursor.execute(
                    """INSERT INTO public.access_oidc_users (actor_id, issuer, subject, email, display_name)
                       VALUES (%s, %s, %s, %s, %s)
                       ON CONFLICT (actor_id) DO UPDATE SET
                         email = EXCLUDED.email,
                         display_name = EXCLUDED.display_name,
                         last_login_at = now()
                       WHERE access_oidc_users.issuer = EXCLUDED.issuer
                         AND access_oidc_users.subject = EXCLUDED.subject
                       RETURNING actor_id""",
                    (actor_id, issuer, actor_id, email, display_name),
                )
                if await cursor.fetchone() is None:
                    raise ValueError("La identidad OIDC coincide con otro proveedor")
                await cursor.execute(
                    "DELETE FROM public.access_user_roles WHERE actor_id = %s AND assignment_source = 'oidc'", (actor_id,),
                )
                await cursor.executemany(
                    """INSERT INTO public.access_user_roles (actor_id, role_code, granted_by, assignment_source)
                       VALUES (%s, %s, 'oidc', 'oidc') ON CONFLICT DO NOTHING""",
                    [(actor_id, role_code) for role_code in roles],
                )
                await cursor.execute(
                    """UPDATE public.access_oidc_users SET observed_groups = %s, role_group_sources = %s,
                       groups_observed_at = CASE WHEN %s::text[] IS NULL THEN NULL ELSE now() END
                       WHERE actor_id = %s""",
                    (mapped_groups, Jsonb(role_groups) if role_groups is not None else None, mapped_groups, actor_id),
                )
                await record_audit(
                    pool, connection=conn, actor_id=actor_id, action="oidc_groups_observed",
                    entity_type="user", entity_id=actor_id,
                    after_data={"groups_observed": mapped_groups is not None,
                                "mapped_group_count": len(mapped_groups) if mapped_groups is not None else None},
                )


async def count_local_users(pool: Any) -> int:
    row = await fetch_one(pool, "SELECT count(*) AS count FROM public.access_users")
    return row["count"] if row else 0


async def get_oidc_login_summary(pool: Any) -> dict[str, Any]:
    """Last observed OIDC login and how many identities have ever signed in.

    ACCESS-OIDC-HEALTH-001: read-only operational context for the admin
    diagnostic. `access_oidc_users` stores no tokens or provider payloads,
    only the identity row updated on each successful login.
    """
    row = await fetch_one(
        pool,
        "SELECT max(last_login_at) AS last_login_at, count(*) AS identities FROM public.access_oidc_users",
    )
    return {
        "last_login_at": row["last_login_at"] if row else None,
        "identities": row["identities"] if row else 0,
    }


async def find_local_user_for_login(pool: Any, email: str) -> dict[str, Any] | None:
    return await fetch_one(
        pool,
        """SELECT actor_id, email, display_name, password_hash, must_change_password, session_version,
            (SELECT array_agg(user_role.role_code ORDER BY user_role.role_code)
             FROM public.access_user_roles user_role WHERE user_role.actor_id = access_users.actor_id) AS roles,
            (SELECT array_agg(role.display_name ORDER BY user_role.role_code)
             FROM public.access_user_roles user_role
             JOIN public.access_roles role USING (role_code)
             WHERE user_role.actor_id = access_users.actor_id) AS role_names
           FROM public.access_users WHERE lower(email) = lower(%s) AND is_active = true""",
        (email,),
    )


async def update_password_hash_after_rehash(pool: Any, actor_id: str, new_password_hash: str) -> None:
    """PENTEST-009: transparently upgrades an already-verified legacy
    (scrypt) hash to Argon2id, or refreshes Argon2id parameters that have
    drifted. Deliberately does not touch session_version or
    must_change_password -- unlike an actual password change, the
    plaintext credential itself hasn't changed, only its storage, so no
    other session should be invalidated and the account owner never sees
    this happen. Best-effort by design: the caller (local_login) must
    never let a failure here block or fail the login it just approved."""
    async with pool.connection() as conn:
        await conn.execute(
            "UPDATE public.access_users SET password_hash = %s WHERE actor_id = %s",
            (new_password_hash, actor_id),
        )


async def get_session_version(pool: Any, actor_id: str) -> int | None:
    """Current session_version for a local, active account, or None if the
    account doesn't exist / was deactivated -- either case must invalidate
    any session claiming to belong to it (PENTEST-004)."""
    row = await fetch_one(
        pool,
        "SELECT session_version FROM public.access_users WHERE actor_id = %s AND is_active = true",
        (actor_id,),
    )
    return row["session_version"] if row else None


async def get_local_account_status(pool: Any, actor_id: str) -> dict[str, Any] | None:
    """Roles/must_change_password for an active local account, or None if the
    actor isn't a local account (or was deactivated) -- the caller falls back
    to get_role_assignment_names() in that case."""
    return await fetch_one(
        pool,
        """SELECT must_change_password,
            (SELECT array_agg(user_role.role_code ORDER BY user_role.role_code)
             FROM public.access_user_roles user_role WHERE user_role.actor_id = access_users.actor_id) AS roles,
            (SELECT array_agg(role.display_name ORDER BY user_role.role_code)
             FROM public.access_user_roles user_role
             JOIN public.access_roles role USING (role_code)
             WHERE user_role.actor_id = access_users.actor_id) AS role_names
           FROM public.access_users WHERE actor_id = %s AND is_active = true""",
        (actor_id,),
    )


async def get_role_assignment_names(pool: Any, actor_id: str) -> dict[str, list[str]]:
    """Role codes/display names for any actor (OIDC or local), independent of
    access_users -- used when the actor has no local account row at all."""
    row = await fetch_one(
        pool,
        """SELECT
            COALESCE(array_agg(user_role.role_code ORDER BY user_role.role_code), ARRAY[]::text[]) AS roles,
            COALESCE(array_agg(role.display_name ORDER BY user_role.role_code), ARRAY[]::text[]) AS role_names
           FROM public.access_user_roles user_role JOIN public.access_roles role USING (role_code)
           WHERE user_role.actor_id = %s""",
        (actor_id,),
    )
    return {"roles": row["roles"] if row else [], "role_names": row["role_names"] if row else []}


async def create_first_local_admin(pool: Any, actor_id: str, display_name: str, password_hash: str) -> None:
    """Self-registration path: only ever succeeds for the very first account.

    Runs under a Postgres advisory lock (scoped to this one operation) so two
    concurrent registration requests can't both pass the "no users yet"
    check and both insert an admin.
    """
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                await cursor.execute("SELECT pg_advisory_xact_lock(hashtext('custodia-first-user'))")
                await cursor.execute("SELECT count(*) AS count FROM public.access_users")
                count = await cursor.fetchone()
                if count["count"] > 0:
                    raise FirstUserAlreadyExists("La cuenta inicial ya fue creada")
                await cursor.execute(
                    "INSERT INTO public.access_users (actor_id, email, display_name, password_hash) VALUES (%s, %s, %s, %s)",
                    (actor_id, actor_id, display_name, password_hash),
                )
                await cursor.execute(
                    "INSERT INTO public.access_user_roles (actor_id, role_code, granted_by) VALUES (%s, 'admin', 'self-registration')",
                    (actor_id,),
                )


async def create_bootstrap_admin(pool: Any, actor_id: str, display_name: str, password_hash: str) -> None:
    """Token-authenticated bootstrap path (AUTH_BOOTSTRAP_TOKEN), no advisory
    lock: the caller already confirmed count == 0 and holds the shared
    secret, so this is an operator-triggered one-time action, not a race
    between untrusted concurrent requests like self-registration is."""
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                await cursor.execute(
                    "INSERT INTO public.access_users (actor_id, email, display_name, password_hash) VALUES (%s, %s, %s, %s)",
                    (actor_id, actor_id, display_name, password_hash),
                )
                await cursor.execute(
                    "INSERT INTO public.access_user_roles (actor_id, role_code, granted_by) VALUES (%s, 'admin', 'bootstrap') ON CONFLICT DO NOTHING",
                    (actor_id,),
                )
