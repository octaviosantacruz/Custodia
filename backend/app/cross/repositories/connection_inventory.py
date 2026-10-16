from __future__ import annotations

import json
from collections.abc import Callable
from datetime import datetime, timezone
from uuid import UUID, uuid4

from psycopg_pool import AsyncConnectionPool

from app.db import fetch_all
from app.cross.repositories.audit import record_audit

# Serializes imports so two operators cannot both plan against the same snapshot.
IMPORT_LOCK_KEY = 7421021

# Every IP of every active SIA access policy, with the capability a person classified it as (null = unclassified).
SIA_IP_VALUES_SQL = """
        sia_ip_values AS (
          SELECT policy.object_id, policy.display_name, policy.source_id, cap.capability,
                 lower(trim(ip_value)) AS private_ip
          FROM public.cyberark_inventory_objects policy
          LEFT JOIN public.sia_policy_capabilities cap ON cap.policy_source_id = policy.source_id
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(policy.attributes->'ip_rules') = 'array'
                 THEN policy.attributes->'ip_rules' ELSE '[]'::jsonb END
          ) AS ip_rule(value)
          CROSS JOIN LATERAL jsonb_array_elements_text(
            CASE
              WHEN jsonb_typeof(ip_rule.value) = 'string' THEN jsonb_build_array(ip_rule.value)
              WHEN jsonb_typeof(ip_rule.value->'ipAddresses') = 'array' THEN ip_rule.value->'ipAddresses'
              WHEN jsonb_typeof(ip_rule.value->'ip_addresses') = 'array' THEN ip_rule.value->'ip_addresses'
              WHEN jsonb_typeof(ip_rule.value->'ips') = 'array' THEN ip_rule.value->'ips'
              ELSE '[]'::jsonb
            END
          ) AS ip_value
          WHERE policy.source_system = 'sia'
            AND policy.object_type = 'access_policy'
            AND policy.lifecycle_status = 'active'
        )"""


def _result_case(declared: str, observed: str) -> str:
    """Declared flag against what a classified SIA policy shows. Without a classified policy on the IP a declared
    "Sí" is only *missing* when no policy at all has that IP; otherwise it is unclassified, never a verdict."""
    return f"""CASE
              WHEN coalesce(flags.{observed}, FALSE) THEN CASE WHEN ci.{declared} IS TRUE THEN 'match' ELSE 'undeclared' END
              WHEN ci.{declared} IS TRUE THEN CASE WHEN coalesce(flags.unclassified, 0) > 0 THEN 'unclassified' ELSE 'missing' END
              WHEN ci.{declared} IS FALSE THEN 'match'
              ELSE 'unknown'
            END"""


# Per destination: the Platform and DBA reading (match / missing / undeclared / unclassified / unknown).
CAPABILITY_RESULTS_SQL = f"""
        sia_flags AS (
          SELECT ci.inventory_id,
                 bool_or(sia.capability = 'platform') AS platform_obs,
                 bool_or(sia.capability = 'dba') AS dba_obs,
                 count(*) FILTER (WHERE sia.capability IS NULL)::int AS unclassified
          FROM public.connection_inventory ci
          JOIN sia_ip_values sia ON sia.private_ip = lower(trim(ci.private_ip))
          WHERE ci.import_id = (SELECT import_id FROM current_import)
          GROUP BY ci.inventory_id
        ),
        capability_results AS (
          SELECT ci.inventory_id,
                 {_result_case("ca_sia", "platform_obs")} AS platform_result,
                 {_result_case("ca_dba", "dba_obs")} AS dba_result
          FROM public.connection_inventory ci
          LEFT JOIN sia_flags flags ON flags.inventory_id = ci.inventory_id
          WHERE ci.import_id = (SELECT import_id FROM current_import)
        )"""


async def list_connection_inventory(
    pool: AsyncConnectionPool,
    q: str = "",
    limit: int = 50,
    offset: int = 0,
    include_internal: bool = True,
    environment: str = "",
    coverage: str = "",
    status: str = "active",
    deviation: str = "",
    work_status: str = "",
    responsible: str = "",
):
    safe_visibility = "" if include_internal else """
          AND coalesce(smeta.inventory_scope, 'pending') <> 'internal'
          AND coalesce(smeta.account_type_classification, '') <> 'internal'
          AND coalesce(a.inventory_account_type, '') <> 'internal'
    """
    rows = await fetch_all(pool, f"""
        WITH current_import AS (
          SELECT import_id, file_name, row_count, created_at
          FROM public.connection_inventory_imports
          WHERE is_current IS TRUE
          ORDER BY created_at DESC
          LIMIT 1
        ),
        safe_matches AS (
          SELECT ci.inventory_id,
                 jsonb_agg(jsonb_build_object(
                   'safe_number', s.safe_number,
                   'safe_name', s.safe_name,
                   'account_id', a.account_id,
                   'account_name', a.account_name,
                   'address', a.address,
                   'platform_name', a.platform_name,
                   'platform_id', a.platform_id
                 ) ORDER BY lower(s.safe_name), a.account_id) AS matches
          FROM public.connection_inventory ci
          JOIN public.cyberark_accounts a
            ON lower(trim(a.address)) = lower(trim(ci.private_ip))
           AND a.lifecycle_status = 'active'
          JOIN public.safes s
            ON s.safe_number = a.safe_number
           AND s.lifecycle_status = 'active'
          LEFT JOIN public.cyberark_safe_metadata smeta ON smeta.safe_number = s.safe_number
          WHERE ci.import_id = (SELECT import_id FROM current_import)
            {safe_visibility}
          GROUP BY ci.inventory_id
        ),
        {SIA_IP_VALUES_SQL},
        sia_matches AS (
          SELECT ci.inventory_id,
                 jsonb_agg(jsonb_build_object(
                   'object_id', sia.object_id,
                   'display_name', sia.display_name,
                   'source_id', sia.source_id,
                   'capability', sia.capability
                 ) ORDER BY lower(sia.display_name), sia.object_id) AS matches
          FROM public.connection_inventory ci
          JOIN sia_ip_values sia ON sia.private_ip = lower(trim(ci.private_ip))
          WHERE ci.import_id = (SELECT import_id FROM current_import)
          GROUP BY ci.inventory_id
        ),
        {CAPABILITY_RESULTS_SQL}
        SELECT ci.inventory_id, ci.source_row_number, ci.instance_name, ci.environment,
               ci.private_ip, ci.port, ci.ca_sia, ci.ca_dba, ci.zsp_implemented,
               ci.access_available, ci.description, ci.lifecycle_status, ci.retired_at,
               ci.work_status, ci.responsible, ci.note,
               current_import.import_id, current_import.file_name, current_import.row_count,
               current_import.created_at AS imported_at,
               coalesce(safe_matches.matches, '[]'::jsonb) AS safe_matches,
               coalesce(sia_matches.matches, '[]'::jsonb) AS sia_matches,
               CASE WHEN ci.lifecycle_status = 'active' THEN results.platform_result END AS platform_result,
               CASE WHEN ci.lifecycle_status = 'active' THEN results.dba_result END AS dba_result,
               count(*) OVER ()::int AS total_count
        FROM public.connection_inventory ci
        JOIN current_import ON current_import.import_id = ci.import_id
        LEFT JOIN safe_matches ON safe_matches.inventory_id = ci.inventory_id
        LEFT JOIN sia_matches ON sia_matches.inventory_id = ci.inventory_id
        LEFT JOIN capability_results results ON results.inventory_id = ci.inventory_id
        WHERE (%s = '' OR ci.private_ip ILIKE '%%' || %s || '%%'
               OR ci.instance_name ILIKE '%%' || %s || '%%'
               OR ci.environment ILIKE '%%' || %s || '%%')
          AND (%s = '' OR lower(trim(ci.environment)) = lower(trim(%s)))
          AND (%s = 'all' OR ci.lifecycle_status = %s)
          AND (%s = '' OR ci.work_status = %s)
          AND (%s = '' OR (%s = 'none' AND ci.responsible = '') OR ci.responsible = %s)
          AND (%s = '' OR ci.lifecycle_status = 'active' AND (
                 (%s IN ('platform', 'any') AND results.platform_result IN ('missing', 'undeclared'))
              OR (%s IN ('dba', 'any') AND results.dba_result IN ('missing', 'undeclared'))))
          AND (%s = ''
               OR (%s = 'both' AND safe_matches.inventory_id IS NOT NULL AND sia_matches.inventory_id IS NOT NULL)
               OR (%s = 'pam_only' AND safe_matches.inventory_id IS NOT NULL AND sia_matches.inventory_id IS NULL)
               OR (%s = 'sia_only' AND safe_matches.inventory_id IS NULL AND sia_matches.inventory_id IS NOT NULL)
               OR (%s = 'none' AND safe_matches.inventory_id IS NULL AND sia_matches.inventory_id IS NULL))
        ORDER BY lower(ci.instance_name), ci.inventory_id
        LIMIT %s OFFSET %s
    """, (q, q, q, q, environment, environment, status, status, work_status, work_status, responsible, responsible, responsible, deviation, deviation, deviation, coverage, coverage, coverage, coverage, coverage, limit, offset))
    total = rows[0]["total_count"] if rows else 0
    for row in rows:
        row.pop("total_count", None)
        row["safe_match_count"] = len(row.get("safe_matches") or [])
        row["sia_match_count"] = len(row.get("sia_matches") or [])
    metadata = rows[0] if rows else None
    if metadata is None:
        metadata_rows = await fetch_all(pool, """
            SELECT import_id, file_name, row_count, created_at AS imported_at
            FROM public.connection_inventory_imports
            WHERE is_current IS TRUE
            ORDER BY created_at DESC
            LIMIT 1
        """)
        metadata = metadata_rows[0] if metadata_rows else None
    return {
        "rows": rows,
        "total": total,
        "limit": limit,
        "offset": offset,
        "search": q,
        "filters": {"environment": environment, "coverage": coverage, "status": status, "deviation": deviation, "work_status": work_status, "responsible": responsible},
        "import": {
            "import_id": metadata["import_id"],
            "file_name": metadata["file_name"],
            "row_count": metadata["row_count"],
            "imported_at": metadata["imported_at"],
        } if metadata else None,
    }


async def get_connection_coverage(pool: AsyncConnectionPool, include_internal: bool = True):
    """Summarize the current imported connection inventory using exact IP
    matches only. PAM and SIA remain independent source observations."""
    safe_visibility = "" if include_internal else """
          AND coalesce(smeta.inventory_scope, 'pending') <> 'internal'
          AND coalesce(smeta.account_type_classification, '') <> 'internal'
          AND coalesce(a.inventory_account_type, '') <> 'internal'
    """
    rows = await fetch_all(pool, f"""
        WITH current_import AS (
          SELECT import_id, file_name, row_count, created_at
          FROM public.connection_inventory_imports
          WHERE is_current IS TRUE
          ORDER BY created_at DESC
          LIMIT 1
        ),
        safe_matches AS (
          SELECT DISTINCT ci.inventory_id
          FROM public.connection_inventory ci
          JOIN public.cyberark_accounts a
            ON lower(trim(a.address)) = lower(trim(ci.private_ip))
           AND a.lifecycle_status = 'active'
          JOIN public.safes s ON s.safe_number = a.safe_number AND s.lifecycle_status = 'active'
          LEFT JOIN public.cyberark_safe_metadata smeta ON smeta.safe_number = s.safe_number
          WHERE ci.import_id = (SELECT import_id FROM current_import)
            {safe_visibility}
        ),
        sia_ip_values AS (
          SELECT lower(trim(ip_value)) AS private_ip
          FROM public.cyberark_inventory_objects policy
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(policy.attributes->'ip_rules') = 'array'
                 THEN policy.attributes->'ip_rules' ELSE '[]'::jsonb END
          ) AS ip_rule(value)
          CROSS JOIN LATERAL jsonb_array_elements_text(
            CASE
              WHEN jsonb_typeof(ip_rule.value) = 'string' THEN jsonb_build_array(ip_rule.value)
              WHEN jsonb_typeof(ip_rule.value->'ipAddresses') = 'array' THEN ip_rule.value->'ipAddresses'
              WHEN jsonb_typeof(ip_rule.value->'ip_addresses') = 'array' THEN ip_rule.value->'ip_addresses'
              WHEN jsonb_typeof(ip_rule.value->'ips') = 'array' THEN ip_rule.value->'ips'
              ELSE '[]'::jsonb
            END
          ) AS ip_value
          WHERE policy.source_system = 'sia'
            AND policy.object_type = 'access_policy'
            AND policy.lifecycle_status = 'active'
        ),
        sia_matches AS (
          SELECT DISTINCT ci.inventory_id
          FROM public.connection_inventory ci
          JOIN sia_ip_values sia ON sia.private_ip = lower(trim(ci.private_ip))
          WHERE ci.import_id = (SELECT import_id FROM current_import)
        )
        SELECT coalesce(nullif(trim(ci.environment), ''), 'Sin ambiente') AS environment,
               count(*)::int AS total,
               count(*) FILTER (WHERE safe_matches.inventory_id IS NOT NULL AND sia_matches.inventory_id IS NOT NULL)::int AS both,
               count(*) FILTER (WHERE safe_matches.inventory_id IS NOT NULL AND sia_matches.inventory_id IS NULL)::int AS pam_only,
               count(*) FILTER (WHERE safe_matches.inventory_id IS NULL AND sia_matches.inventory_id IS NOT NULL)::int AS sia_only,
               count(*) FILTER (WHERE safe_matches.inventory_id IS NULL AND sia_matches.inventory_id IS NULL)::int AS none,
               count(*) FILTER (WHERE ci.zsp_implemented IS TRUE)::int AS zsp_implemented,
               count(*) FILTER (WHERE ci.zsp_implemented IS FALSE)::int AS zsp_pending,
               count(*) FILTER (WHERE ci.zsp_implemented IS NULL)::int AS zsp_unknown,
               current_import.import_id, current_import.file_name, current_import.row_count,
               current_import.created_at AS imported_at
        FROM public.connection_inventory ci
        JOIN current_import ON current_import.import_id = ci.import_id
        LEFT JOIN safe_matches ON safe_matches.inventory_id = ci.inventory_id
        LEFT JOIN sia_matches ON sia_matches.inventory_id = ci.inventory_id
        WHERE ci.lifecycle_status = 'active'
        GROUP BY coalesce(nullif(trim(ci.environment), ''), 'Sin ambiente'), current_import.import_id, current_import.file_name,
                 current_import.row_count, current_import.created_at
        ORDER BY total DESC, environment
    """)
    totals = {key: sum(int(row.get(key) or 0) for row in rows)
              for key in ("total", "both", "pam_only", "sia_only", "none", "zsp_implemented", "zsp_pending", "zsp_unknown")}
    metadata = rows[0] if rows else None
    if metadata is None:
        metadata_rows = await fetch_all(pool, """
            SELECT import_id, file_name, row_count, created_at AS imported_at
            FROM public.connection_inventory_imports
            WHERE is_current IS TRUE ORDER BY created_at DESC LIMIT 1
        """)
        metadata = metadata_rows[0] if metadata_rows else None
    environments = [{key: row[key] for key in ("environment", "total", "both", "pam_only", "sia_only", "none", "zsp_implemented", "zsp_pending", "zsp_unknown")} for row in rows]
    return {
        "totals": totals,
        "by_environment": environments,
        "import": {key: metadata[key] for key in ("import_id", "file_name", "row_count", "imported_at")} if metadata else None,
    }


Planner = Callable[[list[dict], list[dict], str], dict]

_ROW_COLUMNS = (
    "inventory_id", "source_row_number", "instance_name", "environment", "private_ip", "port",
    "ca_sia", "ca_dba", "zsp_implemented", "access_available", "description", "lifecycle_status", "retired_at",
    "work_status", "responsible", "note",
)


async def _current_rows(conn) -> list[dict]:
    cursor = await conn.execute(f"""
        SELECT {", ".join(f"ci.{column}" for column in _ROW_COLUMNS)}
        FROM public.connection_inventory ci
        JOIN public.connection_inventory_imports imp ON imp.import_id = ci.import_id AND imp.is_current IS TRUE
        ORDER BY ci.source_row_number
    """)
    return [dict(record) for record in await cursor.fetchall()]


def _public_plan(plan: dict) -> dict:
    return {key: value for key, value in plan.items() if key != "rows"}


async def preview_connection_import(pool: AsyncConnectionPool, rows: list[dict], mode: str, planner: Planner) -> dict:
    """What an import would do, without writing anything. ``planner`` is the pure plan of the service layer."""
    async with pool.connection() as conn:
        return _public_plan(planner(await _current_rows(conn), rows, mode))


async def import_connection_inventory(
    pool: AsyncConnectionPool,
    rows: list[dict],
    file_name: str,
    mode: str,
    imported_by: str,
    planner: Planner,
) -> tuple[UUID, dict]:
    """Write the next snapshot. Raises ``ValueError`` when the file has row errors (nothing is written)."""
    import_id = uuid4()
    retired_at = datetime.now(timezone.utc)
    async with pool.connection() as conn:
        async with conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock(%s)", (IMPORT_LOCK_KEY,))
            plan = planner(await _current_rows(conn), rows, mode)
            if plan["errors"]:
                raise ValueError("El archivo tiene filas con errores")
            summary = _public_plan(plan)
            summary.pop("samples")
            summary.pop("errors")
            await conn.execute("UPDATE public.connection_inventory_imports SET is_current = FALSE WHERE is_current IS TRUE")
            await conn.execute(
                """
                INSERT INTO public.connection_inventory_imports (import_id, file_name, row_count, imported_by, mode, summary)
                VALUES (%s, %s, %s, %s, %s, %s::jsonb)
                """,
                (import_id, file_name, len(plan["rows"]), imported_by, mode, json.dumps(summary)),
            )
            async with conn.cursor() as cursor:
                await cursor.executemany(
                    """
                    INSERT INTO public.connection_inventory
                      (import_id, source_row_number, instance_name, environment, private_ip, port,
                       ca_sia, ca_dba, zsp_implemented, access_available, description, lifecycle_status, retired_at,
                       work_status, responsible, note)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    [(
                        import_id, row["source_row_number"], row["instance_name"], row["environment"],
                        row["private_ip"], row["port"], row["ca_sia"], row["ca_dba"],
                        row["zsp_implemented"], row["access_available"], row["description"],
                        row["lifecycle_status"],
                        retired_at if row["retired_at"] == "now" else row["retired_at"],
                        row["work_status"], row["responsible"], row["note"],
                    ) for row in plan["rows"]],
                )
            await record_audit(
                pool,
                connection=conn,
                actor_id=imported_by,
                action="import",
                entity_type="connection_inventory",
                entity_id=str(import_id),
                after_data={"file_name": file_name, "mode": mode, **summary["counts"]},
            )
    return import_id, summary


async def export_connection_inventory(pool: AsyncConnectionPool) -> list[dict]:
    """Active destinations of the current snapshot with the exact-IP matches observed in PAM and SIA."""
    result = await list_connection_inventory(pool, "", 100000, 0, True, "", "", "active")
    return result["rows"]


class DestinationConflict(Exception):
    """The IP + port already belongs to another destination of the current inventory."""


EDITABLE_COLUMNS = (
    "instance_name", "environment", "private_ip", "port", "ca_sia", "ca_dba", "zsp_implemented",
    "access_available", "description", "lifecycle_status", "work_status", "responsible", "note",
)


def _same_key(left: dict, right: dict, key_of) -> bool:
    return key_of(left["private_ip"], left["port"]) == key_of(right["private_ip"], right["port"])


async def create_destination(pool: AsyncConnectionPool, values: dict, actor_id: str, key_of) -> int:
    """One manual destination in the current snapshot (a first manual one opens the inventory)."""
    async with pool.connection() as conn:
        async with conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock(%s)", (IMPORT_LOCK_KEY,))
            rows = await _current_rows(conn)
            if any(_same_key(row, values, key_of) for row in rows):
                raise DestinationConflict("Ya existe un destino con esa IP y puerto")
            cursor = await conn.execute("SELECT import_id FROM public.connection_inventory_imports WHERE is_current IS TRUE")
            current = await cursor.fetchone()
            if current is None:
                import_id = uuid4()
                await conn.execute(
                    "INSERT INTO public.connection_inventory_imports (import_id, file_name, row_count, imported_by, mode) VALUES (%s, 'Alta manual', 0, %s, 'update')",
                    (import_id, actor_id),
                )
            else:
                import_id = current["import_id"]
            number = max((row["source_row_number"] for row in rows), default=1) + 1
            cursor = await conn.execute(
                """
                INSERT INTO public.connection_inventory
                  (import_id, source_row_number, instance_name, environment, private_ip, port,
                   ca_sia, ca_dba, zsp_implemented, access_available, description, work_status, responsible, note)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING inventory_id
                """,
                (import_id, number, values["instance_name"], values["environment"], values["private_ip"], values["port"],
                 values["ca_sia"], values["ca_dba"], values["zsp_implemented"], values["access_available"], values["description"],
                 values["work_status"], values["responsible"], values["note"]),
            )
            inventory_id = (await cursor.fetchone())["inventory_id"]
            await conn.execute("UPDATE public.connection_inventory_imports SET row_count = row_count + 1 WHERE import_id = %s", (import_id,))
            await record_audit(
                pool, connection=conn, actor_id=actor_id, action="create", entity_type="connection_inventory_item",
                entity_id=str(inventory_id), after_data={key: values[key] for key in EDITABLE_COLUMNS if key in values},
            )
    return inventory_id


async def update_destinations(pool: AsyncConnectionPool, ids: list[int], changes: dict, actor_id: str, key_of) -> int:
    """Apply the same changes to destinations of the current snapshot, audited per row in one transaction.

    Raises ``LookupError`` when an id is not in the current inventory and ``DestinationConflict`` when a key
    edit lands on another destination. Returns how many rows changed value.
    """
    unique = list(dict.fromkeys(ids))
    async with pool.connection() as conn:
        async with conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock(%s)", (IMPORT_LOCK_KEY,))
            rows = await _current_rows(conn)
            by_id = {row["inventory_id"]: row for row in rows}
            if any(item not in by_id for item in unique):
                raise LookupError("Hay destinos que ya no están en el inventario actual")
            changed = 0
            for inventory_id in unique:
                before = by_id[inventory_id]
                after = {**before, **changes}
                if ("private_ip" in changes or "port" in changes) and any(
                    other["inventory_id"] != inventory_id and _same_key(other, after, key_of) for other in rows
                ):
                    raise DestinationConflict("Ya existe un destino con esa IP y puerto")
                diff = {key: value for key, value in changes.items() if before.get(key) != value}
                if not diff:
                    continue
                assignments = [f"{key} = %s" for key in diff]
                params = list(diff.values())
                if "lifecycle_status" in diff:
                    assignments.append("retired_at = " + ("now()" if diff["lifecycle_status"] == "retired" else "NULL"))
                await conn.execute(
                    f"UPDATE public.connection_inventory SET {', '.join(assignments)} WHERE inventory_id = %s",
                    (*params, inventory_id),
                )
                await record_audit(
                    pool, connection=conn, actor_id=actor_id, action="bulk_update" if len(unique) > 1 else "update",
                    entity_type="connection_inventory_item", entity_id=str(inventory_id),
                    before_data={key: before.get(key) for key in diff}, after_data=diff,
                )
                changed += 1
    return changed


async def get_capability_deviations(pool: AsyncConnectionPool) -> dict:
    """Active destinations by Platform and DBA reading, plus how many SIA policies a person has classified."""
    rows = await fetch_all(pool, f"""
        WITH current_import AS (
          SELECT import_id FROM public.connection_inventory_imports WHERE is_current IS TRUE ORDER BY created_at DESC LIMIT 1
        ),
        {SIA_IP_VALUES_SQL},
        {CAPABILITY_RESULTS_SQL}
        SELECT 'platform' AS capability, results.platform_result AS result, count(*)::int AS total
        FROM public.connection_inventory ci JOIN capability_results results ON results.inventory_id = ci.inventory_id
        WHERE ci.lifecycle_status = 'active' GROUP BY results.platform_result
        UNION ALL
        SELECT 'dba', results.dba_result, count(*)::int
        FROM public.connection_inventory ci JOIN capability_results results ON results.inventory_id = ci.inventory_id
        WHERE ci.lifecycle_status = 'active' GROUP BY results.dba_result
    """)
    readings = ("match", "missing", "undeclared", "unclassified", "unknown")
    out: dict = {capability: {name: 0 for name in readings} for capability in ("platform", "dba")}
    for row in rows:
        out[row["capability"]][row["result"]] = row["total"]
    policies = await fetch_all(pool, """
        SELECT count(*)::int AS total, count(cap.policy_source_id)::int AS classified
        FROM public.cyberark_inventory_objects policy
        LEFT JOIN public.sia_policy_capabilities cap ON cap.policy_source_id = policy.source_id
        WHERE policy.source_system = 'sia' AND policy.object_type = 'access_policy' AND policy.lifecycle_status = 'active'
    """)
    work = await fetch_all(pool, """
        SELECT ci.work_status, count(*)::int AS total
        FROM public.connection_inventory ci
        JOIN public.connection_inventory_imports imp ON imp.import_id = ci.import_id AND imp.is_current IS TRUE
        WHERE ci.lifecycle_status = 'active' GROUP BY ci.work_status
    """)
    responsibles = await fetch_all(pool, """
        SELECT ci.responsible, count(*)::int AS total
        FROM public.connection_inventory ci
        JOIN public.connection_inventory_imports imp ON imp.import_id = ci.import_id AND imp.is_current IS TRUE
        WHERE ci.lifecycle_status = 'active' AND ci.responsible <> '' GROUP BY ci.responsible ORDER BY lower(ci.responsible)
    """)
    work_counts = {"pending": 0, "in_progress": 0, "onboarded": 0, "blocked": 0, "not_applicable": 0}
    work_counts.update({row["work_status"]: row["total"] for row in work})
    return {**out, "policies": {"total": policies[0]["total"], "classified": policies[0]["classified"]},
            "work": work_counts, "responsibles": responsibles}


async def connection_history(pool: AsyncConnectionPool, inventory_id: int, limit: int = 30) -> list[dict]:
    """Audit events of one destination across snapshots: every row that shares its IP and port."""
    return await fetch_all(pool, """
        WITH target AS (
          SELECT lower(trim(private_ip)) AS ip, port FROM public.connection_inventory WHERE inventory_id = %s
        ),
        same AS (
          SELECT ci.inventory_id::text AS id FROM public.connection_inventory ci JOIN target
            ON lower(trim(ci.private_ip)) = target.ip AND ci.port IS NOT DISTINCT FROM target.port
        )
        SELECT a.actor_id, a.action, a.before_data, a.after_data, a.created_at
        FROM public.access_audit_log a
        WHERE a.entity_type = 'connection_inventory_item' AND a.entity_id IN (SELECT id FROM same)
        ORDER BY a.created_at DESC, a.audit_id DESC LIMIT %s
    """, (inventory_id, limit))


_IPV4_LITERAL = r"^((25[0-5]|2[0-4][0-9]|1?[0-9]{1,2})\.){3}(25[0-5]|2[0-4][0-9]|1?[0-9]{1,2})$"


async def list_uninventoried_addresses(pool: AsyncConnectionPool, include_internal: bool = True, limit: int = 100) -> dict:
    """IPv4 addresses a PAM account or a SIA policy rule names that no row of the current inventory carries.

    Only exact IPv4 literals are compared, as everywhere else in Cobertura: hostnames, ranges and CIDR blocks are
    not matched or listed. A destination retired from the inventory still holds its IP, so it is not listed here.
    """
    safe_visibility = "" if include_internal else """
          AND coalesce(smeta.inventory_scope, 'pending') <> 'internal'
          AND coalesce(smeta.account_type_classification, '') <> 'internal'
          AND coalesce(a.inventory_account_type, '') <> 'internal'
    """
    rows = await fetch_all(pool, f"""
        WITH current_import AS (
          SELECT import_id FROM public.connection_inventory_imports WHERE is_current IS TRUE ORDER BY created_at DESC LIMIT 1
        ),
        known AS (
          SELECT DISTINCT lower(trim(ci.private_ip)) AS address
          FROM public.connection_inventory ci WHERE ci.import_id = (SELECT import_id FROM current_import)
        ),
        pam AS (
          SELECT lower(trim(a.address)) AS address, count(*)::int AS accounts, count(DISTINCT a.safe_number)::int AS safes
          FROM public.cyberark_accounts a
          JOIN public.safes s ON s.safe_number = a.safe_number AND s.lifecycle_status = 'active'
          LEFT JOIN public.cyberark_safe_metadata smeta ON smeta.safe_number = s.safe_number
          WHERE a.lifecycle_status = 'active' AND lower(trim(a.address)) ~ %s
            {safe_visibility}
          GROUP BY 1
        ),
        {SIA_IP_VALUES_SQL},
        sia AS (
          SELECT private_ip AS address, count(DISTINCT source_id)::int AS policies,
                 (array_agg(DISTINCT display_name ORDER BY display_name))[1:3] AS policy_names
          FROM sia_ip_values WHERE private_ip ~ %s GROUP BY 1
        ),
        observed AS (
          SELECT address FROM pam UNION SELECT address FROM sia
        )
        SELECT observed.address,
               coalesce(pam.accounts, 0) AS pam_accounts, coalesce(pam.safes, 0) AS pam_safes,
               coalesce(sia.policies, 0) AS sia_policies, coalesce(sia.policy_names, ARRAY[]::text[]) AS sia_policy_names,
               count(*) OVER ()::int AS total
        FROM observed
        LEFT JOIN pam ON pam.address = observed.address
        LEFT JOIN sia ON sia.address = observed.address
        WHERE NOT EXISTS (SELECT 1 FROM known WHERE known.address = observed.address)
          AND EXISTS (SELECT 1 FROM current_import)
        ORDER BY (coalesce(pam.accounts, 0) > 0 AND coalesce(sia.policies, 0) > 0) DESC, observed.address
        LIMIT %s
    """, (_IPV4_LITERAL, _IPV4_LITERAL, limit))
    return {
        "total": rows[0]["total"] if rows else 0,
        "rows": [{key: value for key, value in row.items() if key != "total"} for row in rows],
    }


async def list_stale_destinations(pool: AsyncConnectionPool, days: int, limit: int = 50) -> dict:
    """Active destinations still pending, in progress or blocked whose work state has not moved for ``days`` days.

    The last movement is the latest audited change of ``work_status`` on any row sharing the destination's IP and
    port across imports; with none, the destination counts from the first import it appeared in.
    """
    rows = await fetch_all(pool, """
        WITH stale AS (
          SELECT ci.inventory_id, ci.instance_name, ci.environment, ci.private_ip, ci.port, ci.work_status, ci.responsible,
                 moves.last_change, moves.first_seen,
                 coalesce(moves.last_change, moves.first_seen) AS idle_since
          FROM public.connection_inventory ci
          JOIN public.connection_inventory_imports imp ON imp.import_id = ci.import_id AND imp.is_current IS TRUE
          CROSS JOIN LATERAL (
            SELECT (SELECT max(a.created_at) FROM public.access_audit_log a
                    WHERE a.entity_type = 'connection_inventory_item' AND a.after_data ? 'work_status'
                      AND a.entity_id IN (SELECT same.inventory_id::text FROM public.connection_inventory same
                                          WHERE lower(trim(same.private_ip)) = lower(trim(ci.private_ip))
                                            AND same.port IS NOT DISTINCT FROM ci.port)) AS last_change,
                   (SELECT min(same.created_at) FROM public.connection_inventory same
                    WHERE lower(trim(same.private_ip)) = lower(trim(ci.private_ip))
                      AND same.port IS NOT DISTINCT FROM ci.port) AS first_seen
          ) moves
          WHERE ci.lifecycle_status = 'active' AND ci.work_status IN ('pending', 'in_progress', 'blocked')
        )
        SELECT inventory_id, instance_name, environment, private_ip, port, work_status,
               coalesce(nullif(trim(responsible), ''), 'Sin responsable') AS responsible,
               last_change, idle_since,
               floor(extract(epoch FROM (now() - idle_since)) / 86400)::int AS idle_days,
               count(*) OVER ()::int AS total
        FROM stale
        WHERE idle_since <= now() - make_interval(days => %s)
        ORDER BY idle_since, inventory_id
        LIMIT %s
    """, (days, limit))
    return {
        "days": days,
        "total": rows[0]["total"] if rows else 0,
        "rows": [{key: value for key, value in row.items() if key != "total"} for row in rows],
    }


_READINGS = ("match", "missing", "undeclared", "unclassified", "unknown")
_WORK = ("pending", "in_progress", "onboarded", "blocked", "not_applicable")


def _block(row: dict) -> dict:
    return {
        "n": row["n"],
        "platform": {name: row[f"platform_{name}"] for name in _READINGS},
        "dba": {name: row[f"dba_{name}"] for name in _READINGS},
        "work": {name: row[f"work_{name}"] for name in _WORK},
    }


_PROGRESS_GROUPS = {
    "environment": "coalesce(nullif(trim(ci.environment), ''), 'Sin ambiente')",
    "responsible": "coalesce(nullif(trim(ci.responsible), ''), 'Sin responsable')",
}


async def get_coverage_progress(pool: AsyncConnectionPool) -> dict:
    """Counts of the active destinations: the total, each environment and each responsible, as "X of N" per capability and work state."""
    counts = ",\n               ".join(
        [f"count(*) FILTER (WHERE results.platform_result = '{name}')::int AS platform_{name}" for name in _READINGS]
        + [f"count(*) FILTER (WHERE results.dba_result = '{name}')::int AS dba_{name}" for name in _READINGS]
        + [f"count(*) FILTER (WHERE ci.work_status = '{name}')::int AS work_{name}" for name in _WORK]
    )

    async def grouped(dimension: str) -> list[dict]:
        # The expression comes from the fixed _PROGRESS_GROUPS map, never from a request.
        return await fetch_all(pool, f"""
            WITH current_import AS (
              SELECT import_id FROM public.connection_inventory_imports WHERE is_current IS TRUE ORDER BY created_at DESC LIMIT 1
            ),
            {SIA_IP_VALUES_SQL},
            {CAPABILITY_RESULTS_SQL}
            SELECT {_PROGRESS_GROUPS[dimension]} AS label, count(*)::int AS n,
                   {counts}
            FROM public.connection_inventory ci
            JOIN capability_results results ON results.inventory_id = ci.inventory_id
            WHERE ci.lifecycle_status = 'active'
            GROUP BY 1 ORDER BY n DESC, label
        """)

    rows = await grouped("environment")
    responsible_rows = await grouped("responsible")
    total = {"n": 0, **{f"platform_{k}": 0 for k in _READINGS}, **{f"dba_{k}": 0 for k in _READINGS}, **{f"work_{k}": 0 for k in _WORK}}
    for row in rows:
        for key in total:
            total[key] += row[key]
    return {
        "total": _block(total),
        "by_environment": [{"environment": row["label"], **_block(row)} for row in rows],
        "by_responsible": [{"responsible": row["label"], **_block(row)} for row in responsible_rows],
    }


async def save_coverage_snapshot(pool: AsyncConnectionPool, trigger: str) -> dict:
    """Record today's counts (the last one of the day replaces the earlier ones) and return them."""
    from psycopg.types.json import Jsonb

    progress = await get_coverage_progress(pool)
    async with pool.connection() as conn:
        await conn.execute(
            """
            INSERT INTO public.connection_coverage_snapshots (snapshot_date, captured_at, trigger, counts)
            VALUES ((now() AT TIME ZONE 'UTC')::date, now(), %s, %s)
            ON CONFLICT (snapshot_date) DO UPDATE SET captured_at = EXCLUDED.captured_at, trigger = EXCLUDED.trigger, counts = EXCLUDED.counts
            """,
            (trigger, Jsonb(progress)),
        )
    return progress


async def list_coverage_series(pool: AsyncConnectionPool, weeks: int = 26) -> list[dict]:
    """The last snapshot of each week, oldest first, with the totals only."""
    rows = await fetch_all(pool, """
        SELECT snapshot_date, captured_at, counts->'total' AS total FROM (
          SELECT DISTINCT ON (date_trunc('week', snapshot_date)) snapshot_date, captured_at, counts
          FROM public.connection_coverage_snapshots
          ORDER BY date_trunc('week', snapshot_date) DESC, snapshot_date DESC
          LIMIT %s
        ) latest ORDER BY snapshot_date
    """, (weeks,))
    return [{"snapshot_date": row["snapshot_date"], "captured_at": row["captured_at"], **row["total"]} for row in rows]
