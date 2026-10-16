"""Read-only, single-hop expansion of the verified CyberArk PAM graph.

Separate responsibility from ``pam_chain_queries.py`` (the fixed
user -> role -> Safe -> platform -> PSM chain): this module expands **any**
node one hop at a time, in both directions, from an explicit edge allowlist.
Both endpoints must be active, and ``include_internal`` filters Safes with the
same predicate as ``repositories/search.py``.

The only shared piece with other sources is the response shape; the SQL is
explicit per hop (no generic repository, per AGENTS.md).
"""

from dataclasses import dataclass
from typing import Any

from psycopg_pool import AsyncConnectionPool

from app.db import fetch_all, fetch_one
from app.cross.repositories.identity_pam_bridge import identity_links_for_pam_users
from app.cyberark.pam.repositories.pam_chain_queries import standard_seat_sql
from app.cyberark.sia.repositories.sia_queries import policies_linked_to_safe, policies_referencing_grantee

PAM_SOURCE_SYSTEM = "cyberark"
ACCESS_SOURCE_SYSTEM = "access"
DEFAULT_LIMIT = 50
MAX_LIMIT = 200
SEARCH_PER_TYPE = 20
DIRECTIONS = ("forward", "back")


@dataclass(frozen=True)
class HopSpec:
    neighbor_type: str
    # None means the edge is derived at read time (platform_id), not persisted.
    relationship_type: str | None
    relation_kind: str
    basis: str


NODE_HOPS: dict[str, dict[str, tuple[HopSpec, ...]]] = {
    "user": {
        "forward": (HopSpec("role", "user_has_role", "persisted", "user_has_role"),),
        "back": (),
    },
    "role": {
        "forward": (HopSpec("safe", "role_grants_access", "persisted", "role_grants_access"),),
        "back": (HopSpec("user", "user_has_role", "persisted", "user_has_role"),),
    },
    "safe": {
        "forward": (HopSpec("platform", "safe_uses_platform", "persisted", "safe_uses_platform"),),
        "back": (HopSpec("role", "role_grants_access", "persisted", "role_grants_access"),),
    },
    "platform": {
        "forward": (
            HopSpec("psm", "platform_uses_psm", "persisted", "platform_uses_psm"),
            HopSpec("access_asset", None, "derived", "platform_id"),
        ),
        "back": (HopSpec("safe", "safe_uses_platform", "persisted", "safe_uses_platform"),),
    },
    "psm": {
        "forward": (),
        "back": (HopSpec("platform", "platform_uses_psm", "persisted", "platform_uses_psm"),),
    },
    "access_asset": {
        "forward": (),
        "back": (HopSpec("platform", None, "derived", "platform_id"),),
    },
    # Terminal SIA references reached from PAM nodes; never a root, and only
    # expanded when the caller also holds a SIA read permission.
    "access_policy": {"forward": (), "back": ()},
}

NODE_TYPES = tuple(NODE_HOPS)
# Search covers the five pivot types the explorer exposes; access assets are
# reached by expansion, not as a search entry point.
SEARCH_TYPES = ("user", "role", "safe", "platform", "psm")

# Edges counted for the per-item `counts` badge, per neighbor type. Kept in
# sync with NODE_HOPS: the count of a neighbor's own expandable hops.
_COUNT_EDGES: dict[str, dict[str, tuple[tuple[str, str], ...]]] = {
    "user": {"forward": (("user_has_role", "role"),), "back": ()},
    "role": {"forward": (("role_grants_access", "safe"),), "back": (("user_has_role", "user"),)},
    "safe": {"forward": (("safe_uses_platform", "platform"),), "back": (("role_grants_access", "role"),)},
    "platform": {"forward": (("platform_uses_psm", "psm"),), "back": (("safe_uses_platform", "safe"),)},
    "psm": {"forward": (), "back": (("platform_uses_psm", "platform"),)},
    "access_asset": {"forward": (), "back": ()},
}


def _source_system_for(node_type: str) -> str:
    return ACCESS_SOURCE_SYSTEM if node_type == "access_asset" else PAM_SOURCE_SYSTEM


def _safe_visibility_sql(metadata_alias: str, include_internal: bool) -> str:
    if include_internal:
        return ""
    return (
        f" AND coalesce({metadata_alias}.inventory_scope, 'pending') <> 'internal'"
        f" AND coalesce({metadata_alias}.account_type_classification, '') <> 'internal'"
    )


# The count subquery uses its own aliases (rel/nbr): the anchor alias passed by
# the caller is the outer row (``n``, ``o``, ``p``) and an inner alias with the
# same name would shadow it, turning every persisted count into 0.
def _relationship_count_sql(
    relationship_type: str,
    neighbor_type: str,
    direction: str,
    anchor_alias: str,
    include_internal: bool,
) -> str:
    neighbor_side = "target" if direction == "forward" else "source"
    anchor_side = "source" if direction == "forward" else "target"
    metadata_join = ""
    metadata_filter = ""
    if neighbor_type == "safe":
        metadata_join = (
            " LEFT JOIN public.cyberark_safe_metadata meta_count"
            " ON meta_count.safe_number::text = nbr.source_id"
        )
        metadata_filter = _safe_visibility_sql("meta_count", include_internal)
    return (
        f"(SELECT count(*)"
        f" FROM public.cyberark_inventory_relationships rel"
        f" JOIN public.cyberark_inventory_objects nbr"
        f"   ON nbr.object_id = rel.{neighbor_side}_object_id"
        f"  AND nbr.source_system = '{PAM_SOURCE_SYSTEM}'"
        f"  AND nbr.object_type = '{neighbor_type}'"
        f"  AND nbr.lifecycle_status = 'active'"
        f"{metadata_join}"
        f" WHERE rel.{anchor_side}_object_id = {anchor_alias}.object_id"
        f"   AND rel.relationship_type = '{relationship_type}'"
        f"   AND rel.lifecycle_status = 'active'{metadata_filter})"
    )


def _derived_count_sql(neighbor_type: str, direction: str, anchor_alias: str) -> str | None:
    if neighbor_type == "platform" and direction == "forward":
        return (
            f"(SELECT count(*) FROM public.cyberark_inventory_objects a"
            f" WHERE a.source_system = '{ACCESS_SOURCE_SYSTEM}'"
            f"   AND a.object_type = 'access_asset'"
            f"   AND a.lifecycle_status = 'active'"
            f"   AND coalesce(a.attributes->>'platform_id', '') <> ''"
            f"   AND a.attributes->>'platform_id' = {anchor_alias}.source_id)"
        )
    if neighbor_type == "access_asset" and direction == "back":
        return (
            f"(SELECT count(*) FROM public.cyberark_inventory_objects p"
            f" WHERE p.source_system = '{PAM_SOURCE_SYSTEM}'"
            f"   AND p.object_type = 'platform'"
            f"   AND p.lifecycle_status = 'active'"
            f"   AND p.source_id = coalesce({anchor_alias}.attributes->>'platform_id', ''))"
        )
    return None


def _count_sql(neighbor_type: str, direction: str, anchor_alias: str, include_internal: bool) -> str:
    parts = [
        _relationship_count_sql(relationship_type, counted_type, direction, anchor_alias, include_internal)
        for relationship_type, counted_type in _COUNT_EDGES[neighbor_type][direction]
    ]
    derived = _derived_count_sql(neighbor_type, direction, anchor_alias)
    if derived:
        parts.append(derived)
    return " + ".join(parts) if parts else "0"


def _persisted_hop_sql(spec: HopSpec, direction: str, include_internal: bool, anchor_id: int) -> tuple[str, list[Any]]:
    neighbor_side = "target" if direction == "forward" else "source"
    anchor_side = "source" if direction == "forward" else "target"
    metadata_join = ""
    metadata_filter = ""
    if spec.neighbor_type == "safe":
        metadata_join = (
            " LEFT JOIN public.cyberark_safe_metadata meta_hop"
            " ON meta_hop.safe_number::text = n.source_id"
        )
        metadata_filter = _safe_visibility_sql("meta_hop", include_internal)
    sql = f"""
        SELECT n.object_id AS id, n.object_type AS node_type,
               n.display_name AS label, n.source_id AS sublabel,
               '{spec.relation_kind}' AS relation_kind, '{spec.basis}' AS basis,
               ({_count_sql(spec.neighbor_type, "forward", "n", include_internal)}) AS forward_count,
               ({_count_sql(spec.neighbor_type, "back", "n", include_internal)}) AS back_count,
               (n.object_type = 'psm' AND coalesce(n.attributes->>'catalog_missing', 'false') = 'true') AS catalog_missing
        FROM public.cyberark_inventory_relationships r
        JOIN public.cyberark_inventory_objects n
          ON n.object_id = r.{neighbor_side}_object_id
         AND n.source_system = '{PAM_SOURCE_SYSTEM}'
         AND n.object_type = %s
         AND n.lifecycle_status = 'active'
        {metadata_join}
        WHERE r.{anchor_side}_object_id = %s
          AND r.relationship_type = %s
          AND r.lifecycle_status = 'active'{metadata_filter}
    """
    return sql, [spec.neighbor_type, anchor_id, spec.relationship_type]


def _derived_hop_sql(spec: HopSpec, direction: str, include_internal: bool, anchor_id: int) -> tuple[str, list[Any]]:
    if spec.neighbor_type == "access_asset" and direction == "forward":
        sql = f"""
            SELECT a.object_id AS id, a.object_type AS node_type,
                   a.display_name AS label, a.source_id AS sublabel,
                   '{spec.relation_kind}' AS relation_kind, '{spec.basis}' AS basis,
                   0 AS forward_count,
                   ({_count_sql("access_asset", "back", "a", include_internal)}) AS back_count,
                   false AS catalog_missing
            FROM public.cyberark_inventory_objects anchor
            JOIN public.cyberark_inventory_objects a
              ON a.source_system = '{ACCESS_SOURCE_SYSTEM}'
             AND a.object_type = 'access_asset'
             AND a.lifecycle_status = 'active'
             AND coalesce(a.attributes->>'platform_id', '') <> ''
             AND a.attributes->>'platform_id' = anchor.source_id
            WHERE anchor.object_id = %s
              AND anchor.source_system = '{PAM_SOURCE_SYSTEM}'
              AND anchor.object_type = 'platform'
              AND anchor.lifecycle_status = 'active'
        """
        return sql, [anchor_id]
    if spec.neighbor_type == "platform" and direction == "back":
        sql = f"""
            SELECT p.object_id AS id, p.object_type AS node_type,
                   p.display_name AS label, p.source_id AS sublabel,
                   '{spec.relation_kind}' AS relation_kind, '{spec.basis}' AS basis,
                   ({_count_sql("platform", "forward", "p", include_internal)}) AS forward_count,
                   ({_count_sql("platform", "back", "p", include_internal)}) AS back_count,
                   false AS catalog_missing
            FROM public.cyberark_inventory_objects anchor
            JOIN public.cyberark_inventory_objects p
              ON p.source_system = '{PAM_SOURCE_SYSTEM}'
             AND p.object_type = 'platform'
             AND p.lifecycle_status = 'active'
             AND p.source_id = coalesce(anchor.attributes->>'platform_id', '')
            WHERE anchor.object_id = %s
              AND anchor.source_system = '{ACCESS_SOURCE_SYSTEM}'
              AND anchor.object_type = 'access_asset'
              AND anchor.lifecycle_status = 'active'
              AND coalesce(anchor.attributes->>'platform_id', '') <> ''
        """
        return sql, [anchor_id]
    raise ValueError(f"Sin SQL derivado para {spec.neighbor_type}/{direction}")


def _hop_sql(spec: HopSpec, direction: str, include_internal: bool, anchor_id: int) -> tuple[str, list[Any]]:
    if spec.relationship_type:
        return _persisted_hop_sql(spec, direction, include_internal, anchor_id)
    return _derived_hop_sql(spec, direction, include_internal, anchor_id)


def _build_hop_union(node_type: str, direction: str, include_internal: bool, anchor_id: int) -> tuple[str, list[Any]]:
    selects: list[str] = []
    params: list[Any] = []
    for spec in NODE_HOPS[node_type][direction]:
        sql, spec_params = _hop_sql(spec, direction, include_internal, anchor_id)
        selects.append(sql)
        params.extend(spec_params)
    return " UNION ALL ".join(selects), params


def _sia_hop(policy: dict, relation_kind: str, basis: str) -> dict:
    return {
        "id": policy["object_id"],
        "node_type": "access_policy",
        "label": policy["display_name"],
        "sublabel": policy["source_id"],
        "relation_kind": relation_kind,
        "basis": basis,
        "forward_count": 0,
        "back_count": 0,
    }


async def _sia_forward_hops(pool: AsyncConnectionPool, node_type: str, node_id: int) -> list[dict]:
    """Terminal SIA tramos from PAM nodes, reusing the SIA repository."""
    if node_type == "safe":
        anchor = await fetch_one(pool, """
            SELECT source_id FROM public.cyberark_inventory_objects
            WHERE object_id = %s AND source_system = 'cyberark' AND object_type = 'safe'
              AND lifecycle_status = 'active'
        """, (node_id,))
        if anchor is None:
            return []
        try:
            safe_number = int(anchor["source_id"])
        except (TypeError, ValueError):
            return []
        policies = await policies_linked_to_safe(pool, safe_number)
        return [_sia_hop(policy, "derived", "ip_literal") for policy in policies]

    if node_type in {"user", "role"}:
        anchor = await fetch_one(pool, """
            SELECT display_name FROM public.cyberark_inventory_objects
            WHERE object_id = %s AND source_system = 'cyberark' AND object_type = %s
              AND lifecycle_status = 'active'
        """, (node_id, node_type))
        if anchor is None:
            return []
        policies = await policies_referencing_grantee(
            pool, anchor["display_name"], include_roles=node_type == "role",
        )
        return [_sia_hop(policy, "reference", "display_name_reference_only") for policy in policies]

    return []


async def _annotate_identity(pool: AsyncConnectionPool, rows: list[dict]) -> None:
    """Attach the linked Identity person to each PAM user row, in one query.

    The person and their PAM account are one node in Relaciones: the row keeps
    the PAM ``object_id`` and gains ``identity`` (name, email, link basis) so the
    UI can title the card with the person and keep the account ids inside it.
    """
    ids = [row["id"] for row in rows if row.get("node_type") == "user"]
    if not ids:
        return
    links = {link["pam_object_id"]: link for link in await identity_links_for_pam_users(pool, ids)}
    for row in rows:
        if row.get("node_type") != "user":
            continue
        link = links.get(row["id"])
        row["identity"] = None if link is None else {
            "object_id": link["identity_object_id"],
            "display_name": link["display_name"],
            "email": link["raw_email"],
            "basis": link["basis"],
        }


async def expand_chain_node(
    pool: AsyncConnectionPool,
    *,
    node_type: str,
    node_id: int,
    direction: str,
    include_internal: bool = True,
    include_sia: bool = False,
    include_identity: bool = False,
    query: str = "",
    limit: int = DEFAULT_LIMIT,
    offset: int = 0,
) -> dict:
    """Return one hop of neighbors for a node, paginated across all its edges.

    ``query`` narrows the returned neighbors by literal case-insensitive
    substring on the same two allowlisted fields the pivot search uses
    (``display_name``/``source_id``); the window count is computed after the
    filter so the column total stays correct.

    ``include_sia`` appends the terminal SIA reference tramos; they are
    composed in Python (small catalog) and shown first on the first page, so
    the total stays consistent with the UI counter.
    """
    specs = NODE_HOPS.get(node_type, {}).get(direction, ())
    rows: list[dict] = []
    total = 0
    if specs:
        union, params = _build_hop_union(node_type, direction, include_internal, node_id)
        filter_sql = " WHERE hops.label ILIKE %s OR hops.sublabel ILIKE %s" if query else ""
        filter_params = [_like_pattern(query), _like_pattern(query)] if query else []
        rows = await fetch_all(pool, f"""
            SELECT hops.*, count(*) OVER ()::int AS total_count
            FROM ({union}) hops{filter_sql}
            ORDER BY lower(hops.label), hops.id
            LIMIT %s OFFSET %s
        """, tuple(params + filter_params + [limit, offset]))
        total = rows[0]["total_count"] if rows else 0
        for row in rows:
            row.pop("total_count", None)
        if include_identity:
            await _annotate_identity(pool, rows)

    sia_hops = await _sia_forward_hops(pool, node_type, node_id) if include_sia and direction == "forward" else []
    if sia_hops and query:
        lowered = query.lower()
        sia_hops = [
            hop for hop in sia_hops
            if lowered in (hop["label"] or "").lower() or lowered in (hop["sublabel"] or "").lower()
        ]
    if sia_hops:
        total += len(sia_hops)
        if offset == 0:
            rows = sia_hops + rows[: max(0, limit - len(sia_hops))]
    return {"rows": rows, "total": total, "limit": limit, "offset": offset}


async def get_chain_node(
    pool: AsyncConnectionPool,
    *,
    node_type: str,
    node_id: int,
    include_internal: bool = True,
    include_sia: bool = False,
    include_identity: bool = False,
) -> dict | None:
    """Return one node with the count of expandable hops per direction."""
    # A deep link must not open an internal Safe while include_internal is off.
    internal_clause = "" if include_internal or node_type != "safe" else """
          AND NOT EXISTS (
            SELECT 1 FROM public.cyberark_safe_metadata meta_node
            WHERE meta_node.safe_number::text = o.source_id
              AND (
                coalesce(meta_node.inventory_scope, 'pending') = 'internal'
                OR coalesce(meta_node.account_type_classification, '') = 'internal'
              )
          )
    """
    row = await fetch_one(pool, f"""
        SELECT o.object_id AS id, o.object_type AS node_type,
               o.display_name AS label, o.source_id AS sublabel,
               ({_count_sql(node_type, "forward", "o", include_internal)}) AS forward_count,
               ({_count_sql(node_type, "back", "o", include_internal)}) AS back_count,
               (o.object_type = 'psm' AND coalesce(o.attributes->>'catalog_missing', 'false') = 'true') AS catalog_missing
        FROM public.cyberark_inventory_objects o
        WHERE o.object_id = %s AND o.object_type = %s
          AND o.lifecycle_status = 'active' AND o.source_system = %s{internal_clause}
    """, (node_id, node_type, _source_system_for(node_type)))
    if row is not None and include_sia:
        row["forward_count"] += len(await _sia_forward_hops(pool, node_type, node_id))
    if row is not None and include_identity:
        await _annotate_identity(pool, [row])
    return row


def _like_pattern(query: str) -> str:
    escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _search_visibility_sql(node_type: str, include_internal: bool) -> str:
    """Same internal-scope predicates as ``repositories/search.py``."""
    if include_internal:
        return ""
    if node_type == "safe":
        return """
          AND coalesce(meta.inventory_scope, 'pending') <> 'internal'
          AND coalesce(meta.account_type_classification, '') <> 'internal'
        """
    if node_type == "role":
        return """
          AND EXISTS (
            SELECT 1
            FROM public.cyberark_inventory_relationships access
            JOIN public.cyberark_inventory_objects safe_object
              ON safe_object.object_id = access.target_object_id
             AND safe_object.source_system = 'cyberark'
             AND safe_object.object_type = 'safe'
             AND safe_object.lifecycle_status = 'active'
            LEFT JOIN public.cyberark_safe_metadata meta
              ON meta.safe_number::text = safe_object.source_id
            WHERE access.source_object_id = o.object_id
              AND access.relationship_type = 'role_grants_access'
              AND access.lifecycle_status = 'active'
              AND coalesce(meta.inventory_scope, 'pending') <> 'internal'
              AND coalesce(meta.account_type_classification, '') <> 'internal'
          )
        """
    if node_type == "user":
        return """
          AND EXISTS (
            SELECT 1
            FROM public.cyberark_inventory_relationships membership
            JOIN public.cyberark_inventory_relationships access
              ON access.source_object_id = membership.target_object_id
             AND access.relationship_type = 'role_grants_access'
             AND access.lifecycle_status = 'active'
            JOIN public.cyberark_inventory_objects safe_object
              ON safe_object.object_id = access.target_object_id
             AND safe_object.source_system = 'cyberark'
             AND safe_object.object_type = 'safe'
             AND safe_object.lifecycle_status = 'active'
            LEFT JOIN public.cyberark_safe_metadata meta
              ON meta.safe_number::text = safe_object.source_id
            WHERE membership.source_object_id = o.object_id
              AND membership.relationship_type = 'user_has_role'
              AND membership.lifecycle_status = 'active'
              AND coalesce(meta.inventory_scope, 'pending') <> 'internal'
              AND coalesce(meta.account_type_classification, '') <> 'internal'
          )
        """
    return ""


async def search_chain_nodes(
    pool: AsyncConnectionPool,
    *,
    query: str,
    node_types: tuple[str, ...],
    include_internal: bool = True,
    standard_seat: str = "",
    status: str = "",
    include_identity: bool = False,
) -> dict:
    """Search PAM chain pivots by name or identifier, grouped by type.

    With ``include_identity`` a PAM user is also found through the name or email
    of the Identity person linked to it (never by the Identity UUID), and the
    result carries that person.

    ``standard_seat`` only applies to PAM users (same predicate as the
    Standard-seat reconciliation) and is always reported per user row so the
    UI can keep the documented "Licencia Standard" badge in Cadenas.
    """
    like = _like_pattern(query)
    groups: dict[str, list[dict]] = {}
    for node_type in node_types:
        extra_ids: list[int] = []
        if node_type == "user" and include_identity and query:
            needle = query.lower()
            extra_ids = [
                link["pam_object_id"] for link in await identity_links_for_pam_users(pool)
                if needle in link["display_name"].lower() or needle in link["raw_email"].lower()
            ]
        metadata_join = ""
        if node_type == "safe":
            metadata_join = (
                " LEFT JOIN public.cyberark_safe_metadata meta"
                " ON meta.safe_number::text = o.source_id"
            )
        seat_select = ", false AS standard_seat_reconciled"
        seat_filter = ""
        if node_type == "user":
            seat_expr = f"({standard_seat_sql('o')})"
            seat_select = f", {seat_expr} AS standard_seat_reconciled"
            if standard_seat == "reconciled":
                seat_filter = f" AND {seat_expr}"
            elif standard_seat == "unreconciled":
                seat_filter = f" AND NOT {seat_expr}"
            if status == "suspended":
                seat_filter += " AND coalesce(o.attributes->>'suspended', 'false') = 'true'"
                seat_filter += """
                  AND EXISTS (
                    SELECT 1
                    FROM public.cyberark_inventory_relationships active_role
                    JOIN public.cyberark_inventory_objects role_object
                      ON role_object.object_id = active_role.target_object_id
                     AND role_object.source_system = 'cyberark'
                     AND role_object.object_type = 'role'
                     AND role_object.lifecycle_status = 'active'
                    WHERE active_role.source_object_id = o.object_id
                      AND active_role.relationship_type = 'user_has_role'
                      AND active_role.lifecycle_status = 'active'
                  )
                """
        rows = await fetch_all(pool, f"""
            SELECT o.object_id AS id, o.object_type AS node_type,
                   o.display_name AS label, o.source_id AS sublabel
                   {seat_select}
            FROM public.cyberark_inventory_objects o
            {metadata_join}
            WHERE o.source_system = %s AND o.object_type = %s
              AND o.lifecycle_status = 'active'
              AND (o.display_name ILIKE %s OR o.source_id ILIKE %s OR o.object_id = ANY(%s))
              {_search_visibility_sql(node_type, include_internal)}{seat_filter}
            ORDER BY lower(o.display_name), o.object_id
            LIMIT %s
        """, (_source_system_for(node_type), node_type, like, like, extra_ids, SEARCH_PER_TYPE))
        if node_type == "user" and include_identity:
            await _annotate_identity(pool, rows)
        groups[node_type] = rows
    return {"query": query, "groups": groups}
