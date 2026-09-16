import secrets

from psycopg_pool import AsyncConnectionPool
from ..auth import hash_password_async, verify_password_async
from ..db import fetch_all
from .admin_invariant import assert_at_least_one_active_admin, lock_admin_invariant
from .audit import record_audit


class InvalidUserPassword(ValueError):
    """Raised when a user password fails the local password policy."""


class InvalidCurrentPassword(ValueError):
    """Raised when a user cannot prove ownership of the local account."""


_PASSWORD_GROUPS = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%&*_-"]


def generate_temp_password() -> str:
    """Generate a random password that satisfies the local password policy.

    Used for account creation so an operator never types (and therefore
    never learns) another user's credential; the account owner sets their
    own password on first login via the existing must_change_password gate.
    """
    all_characters = "".join(_PASSWORD_GROUPS)
    required = [secrets.choice(group) for group in _PASSWORD_GROUPS]
    # Keep generated temporary passwords at 15 characters, above the minimum.
    filler = [secrets.choice(all_characters) for _ in range(11)]
    characters = required + filler
    secrets.SystemRandom().shuffle(characters)
    return "".join(characters)


async def list_users(
    pool: AsyncConnectionPool,
    search: str = '',
    role_filter: str = '',
    status_filter: str = '',
    limit: int = 50,
    offset: int = 0,
):
    where = ["(%s = '' OR u.display_name ILIKE '%%' || %s || '%%' OR u.email ILIKE '%%' || %s || '%%')"]
    params: list[object] = [search, search, search]
    if role_filter:
        where.append("EXISTS (SELECT 1 FROM public.access_user_roles r WHERE r.actor_id = u.actor_id AND r.role_code = %s)")
        params.append(role_filter)
    if status_filter == 'active':
        where.append("u.is_active = true")
    elif status_filter == 'inactive':
        where.append("u.is_active = false")
    elif status_filter == 'pending':
        where.append("u.is_active = true AND u.must_change_password = true")
    rows = await fetch_all(pool, f"""
        SELECT u.actor_id, u.email, u.display_name, u.is_active, u.must_change_password, u.created_at, u.updated_at,
               COALESCE(array_agg(aur.role_code) FILTER (WHERE aur.role_code IS NOT NULL), ARRAY[]::text[]) AS roles,
               count(*) OVER ()::int AS total_count
        FROM public.access_users u
        LEFT JOIN public.access_user_roles aur ON aur.actor_id = u.actor_id
        WHERE {' AND '.join(where)}
        GROUP BY u.actor_id
        ORDER BY lower(u.display_name)
        LIMIT %s OFFSET %s
    """, tuple(params + [limit, offset]))
    total = rows[0]["total_count"] if rows else 0
    for row in rows:
        row.pop("total_count", None)
    return {"rows": rows, "total": total, "limit": limit, "offset": offset}


async def update_own_profile(pool: AsyncConnectionPool, actor_id: str, display_name: str):
    normalized_name = display_name.strip()
    if not normalized_name:
        raise ValueError("El nombre es obligatorio")
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                await cursor.execute("SELECT to_jsonb(u) - 'password_hash' AS data FROM public.access_users u WHERE u.actor_id = %s AND u.is_active = true FOR UPDATE", (actor_id,))
                before = await cursor.fetchone()
                if before is None:
                    return None
                await cursor.execute("UPDATE public.access_users SET display_name = %s, updated_at = now() WHERE actor_id = %s", (normalized_name, actor_id))
                await cursor.execute("SELECT actor_id, email, display_name FROM public.access_users WHERE actor_id = %s", (actor_id,))
                profile = await cursor.fetchone()
                await record_audit(pool, connection=conn, actor_id=actor_id, action="update", entity_type="user", entity_id=actor_id, before_data=before["data"], after_data={"display_name": profile["display_name"]})
    return profile


async def change_own_password(pool: AsyncConnectionPool, actor_id: str, current_password: str, new_password: str) -> int:
    """Changes the caller's own password and returns the account's new
    session_version. The caller (the auth_session.py route) must stamp
    that value into the *current* session immediately -- this bumps
    session_version so any *other* copy of this session (e.g. a stolen
    cookie) stops working on its next request, but the session making this
    very change must not also invalidate itself before the response is
    even sent."""
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                await cursor.execute("SELECT password_hash, to_jsonb(u) - 'password_hash' AS data FROM public.access_users u WHERE u.actor_id = %s AND u.is_active = true FOR UPDATE", (actor_id,))
                user = await cursor.fetchone()
                if user is None or not await verify_password_async(current_password, user["password_hash"]):
                    raise InvalidCurrentPassword("La contraseña actual no es válida")
                try:
                    password_hash = await hash_password_async(new_password)
                except ValueError as exc:
                    raise InvalidUserPassword(str(exc)) from exc
                await cursor.execute(
                    "UPDATE public.access_users SET password_hash = %s, must_change_password = false, session_version = session_version + 1, updated_at = now() WHERE actor_id = %s RETURNING session_version",
                    (password_hash, actor_id),
                )
                new_version = (await cursor.fetchone())["session_version"]
                await record_audit(pool, connection=conn, actor_id=actor_id, action="password_change", entity_type="user", entity_id=actor_id, before_data={"password_changed": False}, after_data={"password_changed": True})
    return new_version


async def create_user(pool: AsyncConnectionPool, email: str, display_name: str, role_code: str, actor_id: str):
    password = generate_temp_password()
    try:
        password_hash = await hash_password_async(password)
    except ValueError as exc:
        raise InvalidUserPassword(str(exc)) from exc
    user_id = email.strip().lower()
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                await cursor.execute("INSERT INTO public.access_users (actor_id, email, display_name, password_hash, must_change_password) VALUES (%s, %s, %s, %s, true)", (user_id, user_id, display_name.strip(), password_hash))
                await cursor.execute("INSERT INTO public.access_user_roles (actor_id, role_code, granted_by) VALUES (%s, %s, %s)", (user_id, role_code, actor_id))
                await cursor.execute("SELECT to_jsonb(u) - 'password_hash' AS data FROM public.access_users u WHERE u.actor_id = %s", (user_id,))
                created = await cursor.fetchone()
                await record_audit(pool, connection=conn, actor_id=actor_id, action="create", entity_type="user", entity_id=user_id, after_data=created["data"])
    return user_id, password


async def reissue_temporary_password(pool: AsyncConnectionPool, user_id: str, actor_id: str):
    password = generate_temp_password()
    try:
        password_hash = await hash_password_async(password)
    except ValueError as exc:
        raise InvalidUserPassword(str(exc)) from exc
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                await cursor.execute("SELECT is_active, must_change_password FROM public.access_users WHERE actor_id = %s FOR UPDATE", (user_id,))
                target = await cursor.fetchone()
                if target is None or not target["is_active"]:
                    return None
                await cursor.execute("UPDATE public.access_users SET password_hash = %s, must_change_password = true, session_version = session_version + 1, updated_at = now() WHERE actor_id = %s", (password_hash, user_id))
                await record_audit(pool, connection=conn, actor_id=actor_id, action="temp_password_reissued", entity_type="user", entity_id=user_id, before_data={"must_change_password": target["must_change_password"]}, after_data={"must_change_password": True})
    return password


async def update_user(pool: AsyncConnectionPool, user_id: str, display_name: str | None, is_active: bool | None, role_code: str | None, password: str | None, actor_id: str):
    # IF-003: a payload with every field omitted used to silently return
    # True (no query ever ran) instead of rejecting the request -- a caller
    # could not tell "nothing changed because you asked for nothing" from
    # "your target user doesn't exist".
    if display_name is None and is_active is None and role_code is None and password is None:
        raise ValueError("El parche no modifica ningún campo")

    changes = []
    params = []
    if display_name is not None:
        changes.append("display_name = %s"); params.append(display_name.strip())
    if is_active is not None:
        changes.append("is_active = %s"); params.append(is_active)
    if password is not None:
        try:
            password_hash = await hash_password_async(password)
        except ValueError as exc:
            raise InvalidUserPassword(str(exc)) from exc
        changes.append("password_hash = %s"); params.append(password_hash); changes.append("must_change_password = true")
    # PENTEST-004: an admin-issued password reset or deactivation must
    # invalidate any session already open for this account, the same way
    # a self-service password change does.
    if password is not None or is_active is False:
        changes.append("session_version = session_version + 1")
    if changes:
        changes.append("updated_at = now()")
    params_with_id = params + [user_id]

    # IF-002/IF-003: the profile/active-state change and the role
    # reassignment used to run in two separate transactions/connections --
    # a failure partway through could leave one half committed, and the
    # admin invariant (checked only for deactivation, never for a role
    # change) could be evaluated against a stale snapshot by two
    # concurrent requests. Both now run in the same transaction, and any
    # mutation that could reduce the active-admin set is serialized behind
    # the same advisory lock before the invariant is checked.
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                if is_active is False or role_code is not None:
                    await lock_admin_invariant(cursor)

                await cursor.execute("SELECT to_jsonb(u) - 'password_hash' AS data FROM public.access_users u WHERE u.actor_id = %s FOR UPDATE", (user_id,))
                before = await cursor.fetchone()
                if before is None:
                    return False

                if is_active is False:
                    await cursor.execute("SELECT is_active FROM public.access_users WHERE actor_id = %s FOR UPDATE", (user_id,))
                    target = await cursor.fetchone()
                    if target and target["is_active"]:
                        await cursor.execute("SELECT count(*) AS count FROM public.access_users WHERE is_active = true")
                        active_count = await cursor.fetchone()
                        if active_count["count"] <= 1:
                            raise ValueError("No se puede desactivar el único usuario activo")

                before_roles = None
                if role_code is not None:
                    await cursor.execute("SELECT coalesce(array_agg(role_code ORDER BY role_code), ARRAY[]::text[]) AS roles FROM public.access_user_roles WHERE actor_id = %s", (user_id,))
                    before_roles = await cursor.fetchone()

                if changes:
                    await cursor.execute("UPDATE public.access_users SET " + ", ".join(changes) + " WHERE actor_id = %s", params_with_id)
                if role_code is not None:
                    await cursor.execute("DELETE FROM public.access_user_roles WHERE actor_id = %s", (user_id,))
                    await cursor.execute("INSERT INTO public.access_user_roles (actor_id, role_code, granted_by) VALUES (%s, %s, %s)", (user_id, role_code, actor_id))

                if is_active is False or role_code is not None:
                    await assert_at_least_one_active_admin(cursor)

                if changes:
                    await cursor.execute("SELECT to_jsonb(u) - 'password_hash' AS data FROM public.access_users u WHERE u.actor_id = %s", (user_id,))
                    after = await cursor.fetchone()
                    await record_audit(pool, connection=conn, actor_id=actor_id, action="update", entity_type="user", entity_id=user_id, before_data=before["data"], after_data=after["data"])
                if role_code is not None:
                    await record_audit(pool, connection=conn, actor_id=actor_id, action="role_change", entity_type="user", entity_id=user_id, before_data={"roles": before_roles["roles"]}, after_data={"roles": [role_code]})
    return True


async def delete_user(pool: AsyncConnectionPool, user_id: str, actor_id: str):
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                # IF-002: serialize against every other mutation that can
                # affect the active-admin invariant (role reassignment,
                # deactivation, custom role/level edits) before reading
                # anything it depends on -- otherwise two concurrent
                # deletes (or a delete racing a role change) could each
                # read a pre-mutation snapshot and both commit.
                await lock_admin_invariant(cursor)
                await cursor.execute("SELECT (to_jsonb(u) - 'password_hash') AS data, u.is_active FROM public.access_users u WHERE u.actor_id = %s FOR UPDATE", (user_id,))
                target = await cursor.fetchone()
                if target is None:
                    return False
                if target["is_active"]:
                    await cursor.execute("SELECT count(*) AS count FROM public.access_users WHERE is_active = true")
                    active_users = await cursor.fetchone()
                    if active_users["count"] <= 1:
                        raise ValueError("No se puede eliminar el único usuario activo")
                await cursor.execute("DELETE FROM public.access_user_roles WHERE actor_id = %s", (user_id,))
                await cursor.execute("DELETE FROM public.access_users WHERE actor_id = %s", (user_id,))
                if target["is_active"]:
                    await assert_at_least_one_active_admin(cursor)
                await record_audit(pool, connection=conn, actor_id=actor_id, action="delete", entity_type="user", entity_id=user_id, before_data=target["data"])
    return True
