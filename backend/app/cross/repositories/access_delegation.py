"""ACCESS-CEILING-001: a delegated actor can never grant more than they hold.

Several mutations hand out authority: creating or editing a direct role,
picking levels for a composite role, and assigning a role to a user. Each
used to validate that the permissions/levels existed in the catalog, but not
that the actor performing the delegation actually held them -- an actor with
`access:roles_manage` or `access:role_assignments_manage` could grant any
permission in the catalog, including `access:manage`, to a role or a third
party.

Every mutation that hands out authority must:
  1. call lock_admin_invariant(cursor) first, inside its own transaction.
     The advisory key is deliberately the same one the active-admin
     invariant uses: a second key would force every call site to agree on an
     acquisition order, and a mismatch would deadlock two concurrent
     mutations. One shared key keeps both invariants serialized without a
     lock-order conflict.
  2. resolve the permission set the mutation is about to grant;
  3. call the matching assert below before the transaction commits.

The ceiling reads the actor's effective permissions from the same view the
session uses (`access_effective_role_permissions`), inside the transaction,
so a concurrent role edit cannot slip an uncommitted grant past the check.
`access:manage` keeps working as the compatibility superpermission: an actor
holding it bypasses the ceiling, exactly as
docs/operations/authentication.md (matriz de permisos) documents.
"""


class DelegationCeilingError(ValueError):
    """Raised when a delegation would grant authority the actor doesn't hold."""


async def _actor_permission_codes(cursor, actor_id: str) -> set[str] | None:
    """Effective permissions of the actor, or None when the actor holds the
    `access:manage` superpermission (the caller then skips the ceiling)."""
    await cursor.execute(
        """SELECT coalesce(array_agg(DISTINCT permission.permission_code), ARRAY[]::text[]) AS codes
           FROM public.access_user_roles assignment
           JOIN public.access_effective_role_permissions permission ON permission.role_code = assignment.role_code
           LEFT JOIN public.access_users actor ON actor.actor_id = assignment.actor_id
           WHERE assignment.actor_id = %s AND (actor.actor_id IS NULL OR actor.is_active = true)""",
        (actor_id,),
    )
    row = await cursor.fetchone()
    codes = set(row["codes"] if row else [])
    return None if "access:manage" in codes else codes


async def assert_delegation_ceiling(cursor, actor_id: str, requested_codes) -> None:
    """Direct roles and explicit permission bundles: the requested set must be
    a subset of the actor's effective permissions."""
    requested = {code for code in requested_codes if code}
    if not requested:
        return
    actor_codes = await _actor_permission_codes(cursor, actor_id)
    if actor_codes is None:
        return
    missing = sorted(requested - actor_codes)
    if missing:
        raise DelegationCeilingError("No podés otorgar permisos que no tenés: " + ", ".join(missing))


async def assert_composite_levels_within_ceiling(cursor, actor_id: str, level_refs) -> None:
    """Composite roles: per domain, the selected level cannot be higher than
    the actor's own. The actor's level is the highest one whose permission set
    the actor already holds -- with the seeded nested levels this matches the
    level they are assigned, and it never allows granting authority the actor
    doesn't have."""
    if not level_refs:
        return
    actor_codes = await _actor_permission_codes(cursor, actor_id)
    if actor_codes is None:
        return
    await cursor.execute(
        """SELECT level.domain_code, level.level_code, level.sort_order, permission.permission_code
           FROM public.access_domain_levels level
           LEFT JOIN public.access_role_permissions permission ON permission.role_code = level.base_role_code"""
    )
    levels: dict[tuple[str, str], dict] = {}
    for row in await cursor.fetchall():
        entry = levels.setdefault(
            (row["domain_code"], row["level_code"]),
            {"sort_order": row["sort_order"], "codes": set()},
        )
        if row["permission_code"]:
            entry["codes"].add(row["permission_code"])
    actor_levels: dict[str, int] = {}
    for (domain_code, _level_code), entry in levels.items():
        if entry["codes"] <= actor_codes:
            actor_levels[domain_code] = max(actor_levels.get(domain_code, 0), entry["sort_order"])
    for ref in level_refs:
        entry = levels.get((ref["domain_code"], ref["level_code"]))
        if entry is None:
            # Unknown level: the caller's own validation reports it first.
            continue
        actor_order = actor_levels.get(ref["domain_code"])
        if actor_order is None or entry["sort_order"] > actor_order:
            raise DelegationCeilingError(
                f"No podés seleccionar el nivel {ref['level_code']} en {ref['domain_code']}: "
                "supera tu nivel de delegación"
            )
        # Defense in depth: if the level catalog ever stops being nested, a
        # lower level with extra permissions must still be rejected.
        missing = sorted(entry["codes"] - actor_codes)
        if missing:
            raise DelegationCeilingError("No podés otorgar permisos que no tenés: " + ", ".join(missing))


async def assert_role_assignment_ceiling(cursor, actor_id: str, role_code: str) -> None:
    """Assigning a role to a user: the role's effective permission set must be
    a subset of the actor's own."""
    actor_codes = await _actor_permission_codes(cursor, actor_id)
    if actor_codes is None:
        return
    await cursor.execute(
        """SELECT coalesce(array_agg(DISTINCT permission_code), ARRAY[]::text[]) AS codes
           FROM public.access_effective_role_permissions WHERE role_code = %s""",
        (role_code,),
    )
    row = await cursor.fetchone()
    requested = set(row["codes"] if row else [])
    missing = sorted(requested - actor_codes)
    if missing:
        raise DelegationCeilingError(
            f"No podés asignar el rol {role_code}: otorga permisos que no tenés (" + ", ".join(missing) + ")"
        )
