"""IF-002: shared invariant -- at least one active local user must always
retain effective access:manage.

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

ADMIN_INVARIANT_LOCK_KEY = "dshub-effective-admin"


async def lock_admin_invariant(cursor) -> None:
    await cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (ADMIN_INVARIANT_LOCK_KEY,))


async def assert_at_least_one_active_admin(cursor) -> None:
    await cursor.execute(
        """
        SELECT EXISTS (
            SELECT 1
            FROM public.access_users actor
            JOIN public.access_user_roles assignment ON assignment.actor_id = actor.actor_id
            JOIN public.access_effective_role_permissions permission ON permission.role_code = assignment.role_code
            WHERE actor.is_active AND permission.permission_code = 'access:manage'
        ) AS has_admin
        """
    )
    row = await cursor.fetchone()
    if not row["has_admin"]:
        raise ValueError("La operación dejaría el sistema sin ningún administrador activo")
