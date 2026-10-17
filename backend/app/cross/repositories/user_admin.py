import secrets

from psycopg_pool import AsyncConnectionPool
from app.auth import hash_password_async, verify_password_async
from app.db import fetch_all
from app.cross.repositories.access_delegation import assert_role_assignment_ceiling
from app.cross.repositories.admin_invariant import assert_at_least_one_active_admin, lock_admin_invariant
from app.cross.repositories.audit import record_audit


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
    # PENTEST-009: MIN_PASSWORD_LENGTH is 15; 4 required + 11 filler = 15,
    # comfortably clearing the minimum with random filler from every group.
    filler = [secrets.choice(all_characters) for _ in range(11)]
    characters = required + filler
    secrets.SystemRandom().shuffle(characters)
    return "".join(characters)


# ACCESS-UI-001: each role with its origin -- 'oidc' (mapped from the identity's
# groups at login, changed only in the provider) or 'manual' (assigned in Custodia).
ROLE_ASSIGNMENTS_SQL = """COALESCE((SELECT jsonb_agg(jsonb_build_object('role_code', assignment.role_code,
                                                 'source', assignment.assignment_source)
                                      ORDER BY assignment.role_code)
                    FROM public.access_user_roles assignment WHERE assignment.actor_id = u.actor_id), '[]'::jsonb)"""


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
        WITH directory AS (
          SELECT actor_id, email, display_name, is_active, must_change_password,
                 created_at, updated_at, 'local'::text AS auth_source,
                 NULL::timestamptz AS last_login_at
          FROM public.access_users
          UNION ALL
          SELECT actor_id, email, display_name, true AS is_active,
                 false AS must_change_password, first_seen_at AS created_at,
                 last_login_at AS updated_at, 'oidc'::text AS auth_source,
                 last_login_at
          FROM public.access_oidc_users
        )
        SELECT u.actor_id, u.email, u.display_name, u.is_active, u.must_change_password,
               u.created_at, u.updated_at, u.auth_source, u.last_login_at,
               COALESCE((SELECT array_agg(aur.role_code ORDER BY aur.role_code)
                         FROM public.access_user_roles aur WHERE aur.actor_id = u.actor_id), ARRAY[]::text[]) AS roles,
               {ROLE_ASSIGNMENTS_SQL} AS role_assignments,
               count(*) OVER ()::int AS total_count
        FROM directory u
        WHERE {' AND '.join(where)}
        ORDER BY lower(u.display_name), u.auth_source, u.actor_id
        LIMIT %s OFFSET %s
    """, tuple(params + [limit, offset]))
    total = rows[0]["total_count"] if rows else 0
    for row in rows:
        row.pop("total_count", None)
    return {"rows": rows, "total": total, "limit": limit, "offset": offset}


_REVIEW_FLAGS = ("inactive_account", "manual_old", "stale_login")

# One row per role assignment of every identity, with the three review signals as booleans. Parameters: days, days,
# then the search text four times.
_ACCESS_REVIEW_CTE = """
        WITH directory AS (
          SELECT actor_id, email, display_name, is_active, 'local'::text AS auth_source, NULL::timestamptz AS last_login_at
          FROM public.access_users
          UNION ALL
          SELECT actor_id, email, display_name, true, 'oidc'::text, last_login_at
          FROM public.access_oidc_users
        ),
        review AS (
          SELECT d.actor_id, d.email, d.display_name, d.is_active, d.auth_source, d.last_login_at,
                 r.role_code, role.display_name AS role_name, r.assignment_source AS source,
                 CASE WHEN r.assignment_source = 'manual' THEN r.granted_at END AS granted_at,
                 CASE WHEN r.assignment_source = 'manual' THEN coalesce(granter.display_name, r.granted_by) END AS granted_by,
                 NOT d.is_active AS inactive_account,
                 (r.assignment_source = 'manual' AND r.granted_at <= now() - make_interval(days => %s)) AS manual_old,
                 (d.auth_source = 'oidc' AND d.last_login_at <= now() - make_interval(days => %s)) AS stale_login
          FROM directory d
          JOIN public.access_user_roles r ON r.actor_id = d.actor_id
          JOIN public.access_roles role ON role.role_code = r.role_code
          LEFT JOIN directory granter ON granter.actor_id = r.granted_by
          WHERE (%s = '' OR d.display_name ILIKE '%%' || %s || '%%' OR d.email ILIKE '%%' || %s || '%%'
                 OR role.display_name ILIKE '%%' || %s || '%%')
        )"""


async def list_access_review(
    pool: AsyncConnectionPool,
    search: str = '',
    flag: str = '',
    days: int = 90,
    limit: int = 50,
    offset: int = 0,
):
    """One row per role assignment with the signals a periodic access review looks at (read-only).

    Flags: ``inactive_account`` (a deactivated local account still holds roles), ``manual_old`` (a role assigned
    in Custodia at least ``days`` days ago) and ``stale_login`` (an Okta identity whose last login is at least
    ``days`` days old). Local accounts record no login, and an Okta role is rewritten at every login, so neither
    gets a date they do not have: ``last_login_at`` / ``granted_at`` stay null instead of being inferred.
    """
    if flag not in ('', 'attention', *_REVIEW_FLAGS):
        raise ValueError("Filtro de revisión desconocido")
    base = (days, days, search, search, search, search)
    summary_rows = await fetch_all(pool, _ACCESS_REVIEW_CTE + """
        SELECT count(*)::int AS assignments,
               count(*) FILTER (WHERE inactive_account OR manual_old OR stale_login)::int AS attention,
               count(*) FILTER (WHERE inactive_account)::int AS inactive_account,
               count(*) FILTER (WHERE manual_old)::int AS manual_old,
               count(*) FILTER (WHERE stale_login)::int AS stale_login
        FROM review
    """, base)
    rows = await fetch_all(pool, _ACCESS_REVIEW_CTE + """
        SELECT review.*, count(*) OVER ()::int AS total_count
        FROM review
        WHERE (%s = '' OR (%s = 'attention' AND (inactive_account OR manual_old OR stale_login))
               OR (%s = 'inactive_account' AND inactive_account)
               OR (%s = 'manual_old' AND manual_old)
               OR (%s = 'stale_login' AND stale_login))
        ORDER BY (inactive_account OR manual_old OR stale_login) DESC,
                 coalesce(granted_at, last_login_at) NULLS LAST, lower(display_name), role_code
        LIMIT %s OFFSET %s
    """, (*base, flag, flag, flag, flag, flag, limit, offset))
    total = rows[0]["total_count"] if rows else 0
    for row in rows:
        row.pop("total_count", None)
        row["flags"] = [name for name in _REVIEW_FLAGS if row.pop(name)]
    return {"rows": rows, "total": total, "limit": limit, "offset": offset, "days": days, "summary": dict(summary_rows[0])}


async def list_people(
    pool: AsyncConnectionPool,
    search: str = '',
    role_filter: str = '',
    status_filter: str = '',
    limit: int = 50,
    offset: int = 0,
):
    """Group directory entries by email for display; keep each identity's grants separate."""
    rows = await fetch_all(pool, """
        WITH directory AS (
          SELECT actor_id, email, display_name, is_active, must_change_password,
                 'local'::text AS auth_source, NULL::timestamptz AS last_login_at,
                 CASE WHEN btrim(email) <> '' THEN lower(btrim(email)) ELSE 'local:' || actor_id END AS person_key
          FROM public.access_users
          UNION ALL
          SELECT actor_id, email, display_name, true AS is_active,
                 false AS must_change_password, 'oidc'::text AS auth_source,
                 last_login_at,
                 CASE WHEN btrim(email) <> '' THEN lower(btrim(email)) ELSE 'oidc:' || actor_id END AS person_key
          FROM public.access_oidc_users
        ), identities AS (
          SELECT u.*,
                 COALESCE((SELECT array_agg(r.role_code ORDER BY r.role_code)
                           FROM public.access_user_roles r WHERE r.actor_id = u.actor_id), ARRAY[]::text[]) AS roles,
                 """ + ROLE_ASSIGNMENTS_SQL + """ AS role_assignments
          FROM directory u
        ), people AS (
          SELECT person_key, min(lower(display_name)) AS sort_name
          FROM identities u
          GROUP BY person_key
          HAVING (%s = '' OR bool_or(u.display_name ILIKE '%%' || %s || '%%' OR u.email ILIKE '%%' || %s || '%%'))
             AND (%s = '' OR bool_or(%s = ANY(u.roles)))
             AND (%s = '' OR bool_or(CASE %s WHEN 'active' THEN u.is_active
                                                    WHEN 'inactive' THEN NOT u.is_active
                                                    WHEN 'pending' THEN u.is_active AND u.must_change_password
                                                    ELSE true END))
        ), paged AS (
          SELECT person_key, sort_name, count(*) OVER ()::int AS total_count
          FROM people ORDER BY sort_name, person_key LIMIT %s OFFSET %s
        )
        SELECT p.person_key, p.total_count, u.actor_id, u.email, u.display_name,
               u.is_active, u.must_change_password, u.auth_source, u.last_login_at, u.roles, u.role_assignments
        FROM paged p JOIN identities u ON u.person_key = p.person_key
        ORDER BY p.sort_name, p.person_key, CASE u.auth_source WHEN 'oidc' THEN 0 ELSE 1 END, u.actor_id
    """, (search, search, search, role_filter, role_filter, status_filter, status_filter, limit, offset))
    total = rows[0]["total_count"] if rows else 0
    people: dict[str, dict] = {}
    for row in rows:
        identity = dict(row)
        person_key = identity.pop("person_key")
        identity.pop("total_count")
        if person_key not in people:
            people[person_key] = {
                "key": person_key, "email": identity["email"],
                "display_name": identity["display_name"], "identities": [],
            }
        people[person_key]["identities"].append(identity)
    return {"rows": list(people.values()), "total": total, "limit": limit, "offset": offset}


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
                # ACCESS-CEILING-001: the initial role assignment is a
                # delegation; serialize and check before inserting anything.
                await lock_admin_invariant(cursor)
                await cursor.execute("SELECT 1 FROM public.access_oidc_users WHERE actor_id = %s", (user_id,))
                if await cursor.fetchone():
                    raise ValueError("El identificador ya pertenece a una identidad OIDC")
                await assert_role_assignment_ceiling(cursor, actor_id, role_code)
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


async def set_automation_access(pool: AsyncConnectionPool, user_id: str, password_hash: str, active: bool, actor_id: str) -> bool:
    """AUTH-AGENT-001: open or close the local account held by browser automation.

    Either way the credential is replaced (no first-login change) and every open
    session ends. Closing deactivates it under the shared admin invariant."""
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                if not active:
                    await lock_admin_invariant(cursor)
                await cursor.execute("SELECT is_active FROM public.access_users WHERE actor_id = %s FOR UPDATE", (user_id,))
                target = await cursor.fetchone()
                if target is None:
                    return False
                await cursor.execute("UPDATE public.access_users SET password_hash = %s, must_change_password = false, is_active = %s, session_version = session_version + 1, updated_at = now() WHERE actor_id = %s", (password_hash, active, user_id))
                if not active:
                    await assert_at_least_one_active_admin(cursor)
                await record_audit(pool, connection=conn, actor_id=actor_id, action="automation_access_opened" if active else "automation_access_closed", entity_type="user", entity_id=user_id, before_data={"is_active": target["is_active"]}, after_data={"is_active": active})
    return True


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
                    # ACCESS-CEILING-001: the new role cannot grant more than
                    # the actor holds (the lock is already held for role
                    # changes above).
                    await assert_role_assignment_ceiling(cursor, actor_id, role_code)
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


class OidcManagedRoleError(ValueError):
    """The role comes from the identity's OIDC groups; it changes only in the provider."""


async def _roles_snapshot(cursor, user_id: str) -> list[dict]:
    await cursor.execute(
        """SELECT role_code, assignment_source AS source FROM public.access_user_roles
           WHERE actor_id = %s ORDER BY role_code""",
        (user_id,),
    )
    return [dict(row) for row in await cursor.fetchall()]


async def _identity_exists(cursor, user_id: str) -> bool:
    await cursor.execute(
        """SELECT 1 AS present FROM public.access_users WHERE actor_id = %s
           UNION ALL SELECT 1 FROM public.access_oidc_users WHERE actor_id = %s""",
        (user_id, user_id),
    )
    return await cursor.fetchone() is not None


async def grant_user_role(pool: AsyncConnectionPool, user_id: str, role_code: str, actor_id: str) -> bool | None:
    """ACCESS-UI-001: add one Custodia ('manual') role to a local or OIDC identity.

    Returns None when the identity does not exist and False when it already
    holds the role. The delegation ceiling applies as for any assignment.
    """
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                await lock_admin_invariant(cursor)
                if not await _identity_exists(cursor, user_id):
                    return None
                await assert_role_assignment_ceiling(cursor, actor_id, role_code)
                before = await _roles_snapshot(cursor, user_id)
                await cursor.execute(
                    """INSERT INTO public.access_user_roles (actor_id, role_code, granted_by, assignment_source)
                       VALUES (%s, %s, %s, 'manual') ON CONFLICT DO NOTHING RETURNING role_code""",
                    (user_id, role_code, actor_id),
                )
                if await cursor.fetchone() is None:
                    return False
                await record_audit(
                    pool, connection=conn, actor_id=actor_id, action="role_grant", entity_type="user", entity_id=user_id,
                    before_data={"roles": before}, after_data={"roles": await _roles_snapshot(cursor, user_id)},
                )
    return True


async def revoke_user_role(pool: AsyncConnectionPool, user_id: str, role_code: str, actor_id: str) -> bool:
    """ACCESS-UI-001: remove one Custodia ('manual') role.

    An 'oidc' role is refused: the next login would bring it back, so it is
    changed only in the provider. Revoking needs the same ceiling as granting,
    and never leaves Custodia without an active administrator.
    """
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                await lock_admin_invariant(cursor)
                await cursor.execute(
                    "SELECT assignment_source FROM public.access_user_roles WHERE actor_id = %s AND role_code = %s FOR UPDATE",
                    (user_id, role_code),
                )
                assignment = await cursor.fetchone()
                if assignment is None:
                    return False
                if assignment["assignment_source"] == "oidc":
                    raise OidcManagedRoleError("Este rol viene de un grupo de Okta; se quita en Okta")
                await assert_role_assignment_ceiling(cursor, actor_id, role_code)
                before = await _roles_snapshot(cursor, user_id)
                await cursor.execute(
                    "DELETE FROM public.access_user_roles WHERE actor_id = %s AND role_code = %s", (user_id, role_code),
                )
                await assert_at_least_one_active_admin(cursor)
                await record_audit(
                    pool, connection=conn, actor_id=actor_id, action="role_revoke", entity_type="user", entity_id=user_id,
                    before_data={"roles": before}, after_data={"roles": await _roles_snapshot(cursor, user_id)},
                )
    return True
