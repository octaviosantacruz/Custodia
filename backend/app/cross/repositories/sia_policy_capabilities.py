"""The person-made classification of SIA access policies as Platform, DBA or other (COV-003)."""

from __future__ import annotations

from psycopg_pool import AsyncConnectionPool

from app.cross.repositories.audit import record_audit
from app.cross.repositories.connection_inventory import SIA_IP_VALUES_SQL
from app.db import fetch_all


async def list_policy_capabilities(pool: AsyncConnectionPool) -> list[dict]:
    """Active SIA policies with their classification and how many destination IPs each one covers."""
    return await fetch_all(pool, f"""
        WITH current_import AS (
          SELECT import_id FROM public.connection_inventory_imports WHERE is_current IS TRUE ORDER BY created_at DESC LIMIT 1
        ),
        {SIA_IP_VALUES_SQL}
        SELECT policy.source_id, policy.display_name, cap.capability, cap.classified_by, cap.classified_at,
               coalesce(policy.attributes->>'status', '') AS status,
               (SELECT count(DISTINCT ci.inventory_id)::int
                  FROM public.connection_inventory ci
                  JOIN sia_ip_values ips ON ips.private_ip = lower(trim(ci.private_ip)) AND ips.source_id = policy.source_id
                 WHERE ci.import_id = (SELECT import_id FROM current_import) AND ci.lifecycle_status = 'active') AS destinations
        FROM public.cyberark_inventory_objects policy
        LEFT JOIN public.sia_policy_capabilities cap ON cap.policy_source_id = policy.source_id
        WHERE policy.source_system = 'sia' AND policy.object_type = 'access_policy' AND policy.lifecycle_status = 'active'
        ORDER BY lower(policy.display_name), policy.source_id
    """)


async def set_policy_capabilities(pool: AsyncConnectionPool, items: list[dict], actor_id: str) -> int:
    """Set or clear (``capability`` null) several policies in one transaction, audited per policy.

    Raises ``LookupError`` for a policy that is not an active SIA access policy. Returns how many rows changed.
    """
    async with pool.connection() as conn:
        async with conn.transaction():
            cursor = await conn.execute("""
                SELECT source_id FROM public.cyberark_inventory_objects
                WHERE source_system = 'sia' AND object_type = 'access_policy' AND lifecycle_status = 'active'
            """)
            known = {row["source_id"] for row in await cursor.fetchall()}
            if any(item["policy_source_id"] not in known for item in items):
                raise LookupError("Hay políticas SIA que no existen o ya no están activas")
            changed = 0
            for item in items:
                policy_id, capability = item["policy_source_id"], item["capability"]
                cursor = await conn.execute("SELECT capability FROM public.sia_policy_capabilities WHERE policy_source_id = %s", (policy_id,))
                current = await cursor.fetchone()
                before = current["capability"] if current else None
                if before == capability:
                    continue
                if capability is None:
                    await conn.execute("DELETE FROM public.sia_policy_capabilities WHERE policy_source_id = %s", (policy_id,))
                else:
                    await conn.execute(
                        """
                        INSERT INTO public.sia_policy_capabilities (policy_source_id, capability, classified_by)
                        VALUES (%s, %s, %s)
                        ON CONFLICT (policy_source_id) DO UPDATE
                          SET capability = EXCLUDED.capability, classified_by = EXCLUDED.classified_by, classified_at = now()
                        """,
                        (policy_id, capability, actor_id),
                    )
                await record_audit(
                    pool, connection=conn, actor_id=actor_id, action="update" if len(items) == 1 else "bulk_update",
                    entity_type="sia_policy_capability", entity_id=policy_id,
                    before_data={"capability": before}, after_data={"capability": capability},
                )
                changed += 1
    return changed
