"""IF-002: shared invariant -- at least one identity able to sign in must always
retain effective access:manage.

AUTH-AGENT-001 (approved by the repository owner, 2026-10-13): an active local
user counts, and so does an identity of the configured OIDC issuer while
AUTH_MODE lets OIDC sign in (oidc/hybrid). Okta is then the administrative
path and the local automation account may stay disabled; its CLI
(scripts/agent_access.py) is the recovery path. In local mode only local
users count, exactly as before.

Several independent mutations can reduce the set of active admins: a
role reassignment, a deactivation, a deletion, or editing a custom role's
permissions/levels away from access:manage. Each used to check this
condition (if at all) with its own ad-hoc COUNT query and its own lock
key, so two of them running concurrently could each read a stale count
and both commit, leaving DS Hub with zero users able to administer access.

Every mutation that can affect this invariant must:
  1. call lock_admin_invariant(cursor) first, inside its own transaction,
     before reading or changing anything the invariant depends on;
  2. apply its change;
  3. call assert_at_least_one_active_admin(cursor) before the transaction
     commits.

The shared lock key serializes all of them against each other, so no two
concurrent mutations can both pass step 3 based on a pre-mutation snapshot.
"""

import os

ADMIN_INVARIANT_LOCK_KEY = "dshub-effective-admin"


def _oidc_admin_issuer() -> str | None:
    """Issuer whose identities can sign in now; read at call time, like app.auth's own setting."""
    if os.environ.get("AUTH_MODE", "local").strip().lower() not in {"oidc", "hybrid"}:
        return None
    return os.environ.get("OIDC_ISSUER_URL", "").strip() or None


async def lock_admin_invariant(cursor) -> None:
    await cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (ADMIN_INVARIANT_LOCK_KEY,))


async def assert_at_least_one_active_admin(cursor) -> None:
    await cursor.execute(
        """
        SELECT EXISTS (
            SELECT 1
            FROM public.access_user_roles assignment
            JOIN public.access_effective_role_permissions permission ON permission.role_code = assignment.role_code
            WHERE permission.permission_code = 'access:manage'
              AND (
                EXISTS (SELECT 1 FROM public.access_users actor WHERE actor.actor_id = assignment.actor_id AND actor.is_active)
                OR EXISTS (
                    SELECT 1 FROM public.access_oidc_users identity
                    WHERE identity.actor_id = assignment.actor_id AND identity.issuer = %s
                )
              )
        ) AS has_admin
        """,
        (_oidc_admin_issuer(),),
    )
    row = await cursor.fetchone()
    if not row["has_admin"]:
        raise ValueError("La operación dejaría el sistema sin ningún administrador activo")
