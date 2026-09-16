from __future__ import annotations

from uuid import UUID, uuid4

from psycopg_pool import AsyncConnectionPool

from ..db import fetch_all
from .audit import record_audit


async def list_connection_inventory(
    pool: AsyncConnectionPool,
    q: str = "",
    limit: int = 50,
    offset: int = 0,
    include_internal: bool = True,
    environment: str = "",
    coverage: str = "",
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
        sia_ip_values AS (
          SELECT policy.object_id, policy.display_name, policy.source_id,
                 lower(trim(ip_value)) AS private_ip
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
          SELECT ci.inventory_id,
                 jsonb_agg(jsonb_build_object(
                   'object_id', sia.object_id,
                   'display_name', sia.display_name,
                   'source_id', sia.source_id
                 ) ORDER BY lower(sia.display_name), sia.object_id) AS matches
          FROM public.connection_inventory ci
          JOIN sia_ip_values sia ON sia.private_ip = lower(trim(ci.private_ip))
          WHERE ci.import_id = (SELECT import_id FROM current_import)
          GROUP BY ci.inventory_id
        )
        SELECT ci.inventory_id, ci.source_row_number, ci.instance_name, ci.environment,
               ci.private_ip, ci.port, ci.ca_sia, ci.ca_dba, ci.zsp_implemented,
               ci.access_available, ci.description,
               current_import.import_id, current_import.file_name, current_import.row_count,
               current_import.created_at AS imported_at,
               coalesce(safe_matches.matches, '[]'::jsonb) AS safe_matches,
               coalesce(sia_matches.matches, '[]'::jsonb) AS sia_matches,
               count(*) OVER ()::int AS total_count
        FROM public.connection_inventory ci
        JOIN current_import ON current_import.import_id = ci.import_id
        LEFT JOIN safe_matches ON safe_matches.inventory_id = ci.inventory_id
        LEFT JOIN sia_matches ON sia_matches.inventory_id = ci.inventory_id
        WHERE (%s = '' OR ci.private_ip ILIKE '%%' || %s || '%%'
               OR ci.instance_name ILIKE '%%' || %s || '%%'
               OR ci.environment ILIKE '%%' || %s || '%%')
          AND (%s = '' OR lower(trim(ci.environment)) = lower(trim(%s)))
          AND (%s = ''
               OR (%s = 'both' AND safe_matches.inventory_id IS NOT NULL AND sia_matches.inventory_id IS NOT NULL)
               OR (%s = 'pam_only' AND safe_matches.inventory_id IS NOT NULL AND sia_matches.inventory_id IS NULL)
               OR (%s = 'sia_only' AND safe_matches.inventory_id IS NULL AND sia_matches.inventory_id IS NOT NULL)
               OR (%s = 'none' AND safe_matches.inventory_id IS NULL AND sia_matches.inventory_id IS NULL))
        ORDER BY lower(ci.instance_name), ci.inventory_id
        LIMIT %s OFFSET %s
    """, (q, q, q, q, environment, environment, coverage, coverage, coverage, coverage, coverage, limit, offset))
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
        "filters": {"environment": environment, "coverage": coverage},
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


async def replace_connection_inventory(
    pool: AsyncConnectionPool,
    rows: list[dict],
    file_name: str,
    imported_by: str,
) -> UUID:
    import_id = uuid4()
    async with pool.connection() as conn:
        async with conn.transaction():
            await conn.execute("UPDATE public.connection_inventory_imports SET is_current = FALSE WHERE is_current IS TRUE")
            await conn.execute(
                """
                INSERT INTO public.connection_inventory_imports (import_id, file_name, row_count, imported_by)
                VALUES (%s, %s, %s, %s)
                """,
                (import_id, file_name, len(rows), imported_by),
            )
            async with conn.cursor() as cursor:
                await cursor.executemany(
                    """
                    INSERT INTO public.connection_inventory
                      (import_id, source_row_number, instance_name, environment, private_ip, port,
                       ca_sia, ca_dba, zsp_implemented, access_available, description)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    [(
                        import_id, row["source_row_number"], row["instance_name"], row["environment"],
                        row["private_ip"], row["port"], row["ca_sia"], row["ca_dba"],
                        row["zsp_implemented"], row["access_available"], row["description"],
                    ) for row in rows],
                )
            await record_audit(
                pool,
                connection=conn,
                actor_id=imported_by,
                action="import",
                entity_type="connection_inventory",
                entity_id=str(import_id),
                after_data={"file_name": file_name, "row_count": len(rows)},
            )
    return import_id
