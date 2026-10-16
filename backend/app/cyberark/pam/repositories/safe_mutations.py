import json

from psycopg_pool import AsyncConnectionPool

from app.db import fetch_one
from app.cyberark.pam.schemas import SafeAccountTypeUpdate, SafeAssignmentUpdate, SafeBulkAssignment, SafeMetadataUpdate, SafeQuickUpdate, SafeScopeUpdate, normalize_next_action
from app.cross.repositories.audit import record_audit


async def update_safe_metadata(pool: AsyncConnectionPool, safe_number: int, payload: SafeMetadataUpdate, actor_id: str):
    normalized_next_action = normalize_next_action(payload.next_action)
    effective_classification = (
        "assigned"
        if payload.business_unit_id is not None and payload.responsible_id is not None
        else "pending"
        if payload.classification_status == "assigned"
        else payload.classification_status
    )
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                await cursor.execute("SELECT 1 FROM public.safes WHERE safe_number = %s", (safe_number,))
                if await cursor.fetchone() is None:
                    return None
                await cursor.execute("SELECT to_jsonb(m) AS data FROM public.cyberark_safe_metadata m WHERE safe_number = %s", (safe_number,))
                before = await cursor.fetchone()
                await cursor.execute("""
                    INSERT INTO public.cyberark_safe_metadata (
                      safe_number, internal_name, business_unit_id, responsible_id,
                      classification_status, inventory_scope, data_quality_status,
                      workflow_status, next_action,
                      notes, assigned_at, assigned_by
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                      CASE WHEN %s::BIGINT IS NOT NULL OR %s::BIGINT IS NOT NULL THEN now() ELSE NULL END,
                      %s)
                    ON CONFLICT (safe_number) DO UPDATE SET
                      internal_name = EXCLUDED.internal_name,
                      business_unit_id = EXCLUDED.business_unit_id,
                      responsible_id = EXCLUDED.responsible_id,
                      classification_status = EXCLUDED.classification_status,
                      inventory_scope = EXCLUDED.inventory_scope,
                      data_quality_status = EXCLUDED.data_quality_status,
                      workflow_status = EXCLUDED.workflow_status,
                      next_action = EXCLUDED.next_action,
                      notes = EXCLUDED.notes,
                      assigned_at = EXCLUDED.assigned_at,
                      assigned_by = EXCLUDED.assigned_by,
                      updated_at = now()
                    RETURNING *
                """, (
                    safe_number, payload.internal_name, payload.business_unit_id,
                    payload.responsible_id, effective_classification,
                    payload.inventory_scope, payload.data_quality_status,
                    payload.workflow_status, normalized_next_action,
                    payload.notes, payload.business_unit_id, payload.responsible_id,
                    actor_id,
                ))
                after = await cursor.fetchone()
                await record_audit(pool, connection=conn, actor_id=actor_id, action="update", entity_type="safe_metadata", entity_id=str(safe_number), before_data=before["data"] if before else None, after_data=after, dumps=lambda value: json.dumps(value, default=str))
                return after


async def update_safe_quick(pool: AsyncConnectionPool, safe_number: int, payload: SafeQuickUpdate, actor_id: str):
    normalized_next_action = normalize_next_action(payload.next_action)
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                await cursor.execute("SELECT 1 FROM public.safes WHERE safe_number = %s", (safe_number,))
                if await cursor.fetchone() is None:
                    return None
                await cursor.execute("SELECT to_jsonb(m) AS data FROM public.cyberark_safe_metadata m WHERE safe_number = %s", (safe_number,))
                before = await cursor.fetchone()
                await cursor.execute("""
                    INSERT INTO public.cyberark_safe_metadata (safe_number, workflow_status, next_action)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (safe_number) DO UPDATE SET
                      workflow_status = EXCLUDED.workflow_status,
                      next_action = EXCLUDED.next_action,
                      updated_at = now()
                    RETURNING workflow_status, next_action
                """, (safe_number, payload.workflow_status, normalized_next_action))
                after = await cursor.fetchone()
                await record_audit(pool, connection=conn, actor_id=actor_id, action="update", entity_type="safe_metadata", entity_id=str(safe_number), before_data=before["data"] if before else None, after_data=after, dumps=lambda value: json.dumps(value, default=str))
                return after


async def update_safe_scope(pool: AsyncConnectionPool, safe_number: int, payload: SafeScopeUpdate, actor_id: str):
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                await cursor.execute("SELECT 1 FROM public.safes WHERE safe_number = %s", (safe_number,))
                if await cursor.fetchone() is None:
                    return None
                await cursor.execute("SELECT to_jsonb(m) AS data FROM public.cyberark_safe_metadata m WHERE safe_number = %s", (safe_number,))
                before = await cursor.fetchone()
                await cursor.execute(
                    """INSERT INTO public.cyberark_safe_metadata (safe_number, inventory_scope)
                       VALUES (%s, %s)
                       ON CONFLICT (safe_number) DO UPDATE SET inventory_scope = EXCLUDED.inventory_scope, updated_at = now()
                       RETURNING inventory_scope""",
                    (safe_number, payload.inventory_scope),
                )
                after = await cursor.fetchone()
                await record_audit(
                    pool, connection=conn, actor_id=actor_id, action="update",
                    entity_type="safe_scope", entity_id=str(safe_number),
                    before_data=before["data"] if before else None, after_data=after,
                    dumps=lambda value: json.dumps(value, default=str),
                )
                return after


async def update_safe_account_type(pool: AsyncConnectionPool, safe_number: int, payload: SafeAccountTypeUpdate, actor_id: str):
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                await cursor.execute("SELECT 1 FROM public.safes WHERE safe_number = %s", (safe_number,))
                if await cursor.fetchone() is None:
                    return None
                await cursor.execute("SELECT to_jsonb(m) AS data FROM public.cyberark_safe_metadata m WHERE safe_number = %s", (safe_number,))
                before = await cursor.fetchone()
                await cursor.execute(
                    """INSERT INTO public.cyberark_safe_metadata (safe_number, account_type_classification)
                       VALUES (%s, %s)
                       ON CONFLICT (safe_number) DO UPDATE SET account_type_classification = EXCLUDED.account_type_classification, updated_at = now()
                       RETURNING account_type_classification""",
                    (safe_number, payload.account_type_classification),
                )
                after = await cursor.fetchone()
                await record_audit(
                    pool, connection=conn, actor_id=actor_id, action="update",
                    entity_type="safe_account_type", entity_id=str(safe_number),
                    before_data=before["data"] if before else None, after_data=after,
                    dumps=lambda value: json.dumps(value, default=str),
                )
                return after


async def update_safe_assignment(pool: AsyncConnectionPool, safe_number: int, payload: SafeAssignmentUpdate, actor_id: str):
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                await cursor.execute("SELECT 1 FROM public.safes WHERE safe_number = %s", (safe_number,))
                if await cursor.fetchone() is None:
                    return None
                await cursor.execute("SELECT to_jsonb(m) AS data FROM public.cyberark_safe_metadata m WHERE safe_number = %s", (safe_number,))
                before = await cursor.fetchone()
                await cursor.execute("""
                    INSERT INTO public.cyberark_safe_metadata (
                      safe_number, business_unit_id, responsible_id,
                      classification_status, assigned_at, assigned_by
                    ) VALUES (%s, %s, %s, CASE WHEN %s::BIGINT IS NOT NULL AND %s::BIGINT IS NOT NULL THEN 'assigned' ELSE 'pending' END,
                      CASE WHEN %s::BIGINT IS NOT NULL OR %s::BIGINT IS NOT NULL THEN now() ELSE NULL END, %s)
                    ON CONFLICT (safe_number) DO UPDATE SET
                      business_unit_id = EXCLUDED.business_unit_id,
                      responsible_id = EXCLUDED.responsible_id,
                      classification_status = EXCLUDED.classification_status,
                      assigned_at = EXCLUDED.assigned_at,
                      assigned_by = EXCLUDED.assigned_by,
                      updated_at = now()
                    RETURNING *
                """, (
                    safe_number, payload.business_unit_id, payload.responsible_id,
                    payload.business_unit_id, payload.responsible_id,
                    payload.business_unit_id, payload.responsible_id, actor_id,
                ))
                after = await cursor.fetchone()
                await record_audit(pool, connection=conn, actor_id=actor_id, action="update", entity_type="safe_assignment", entity_id=str(safe_number), before_data=before["data"] if before else None, after_data=after, dumps=lambda value: json.dumps(value, default=str))
                return after


async def bulk_update_safe_assignment(pool: AsyncConnectionPool, payload: SafeBulkAssignment, actor_id: str):
    """Apply one classification decision to many Safes in a single transaction.
    Owner (business_unit_id + responsible_id) is set together and derives
    classification_status exactly like the single-Safe path; workflow_status
    is independent. Every Safe still writes its own audit row and activity
    event with its own before/after snapshot in the same transaction --
    but batched into a fixed number of round trips (existence+snapshot,
    upsert, audit insert, activity-event insert) regardless of how many
    Safes are selected, instead of ~5 sequential round trips per Safe
    (AUD-PERF-002: 500 selected Safes used to mean ~2500 queries in one
    request). Unknown safe_numbers are reported, not fabricated."""
    from psycopg.types.json import Jsonb

    from app.cross.repositories.audit import activity_event_kind as _activity_event_kind

    assigns_owner = "business_unit_id" in payload.model_fields_set or "responsible_id" in payload.model_fields_set
    set_workflow = payload.workflow_status is not None

    columns = ["safe_number"]
    placeholders = ["%s"]
    base_values: list = []
    conflict_updates = ["updated_at = now()"]
    if assigns_owner:
        columns += ["business_unit_id", "responsible_id", "classification_status", "assigned_at", "assigned_by"]
        placeholders += ["%s", "%s", "%s", "now()", "%s"]
        base_values += [
            payload.business_unit_id, payload.responsible_id,
            "assigned" if payload.business_unit_id and payload.responsible_id else "pending",
            actor_id,
        ]
        conflict_updates += [
            "business_unit_id = EXCLUDED.business_unit_id",
            "responsible_id = EXCLUDED.responsible_id",
            "classification_status = EXCLUDED.classification_status",
            "assigned_at = EXCLUDED.assigned_at",
            "assigned_by = EXCLUDED.assigned_by",
        ]
    if set_workflow:
        columns.append("workflow_status")
        placeholders.append("%s")
        base_values.append(payload.workflow_status)
        conflict_updates.append("workflow_status = EXCLUDED.workflow_status")

    row_template = f"({', '.join(placeholders)})"
    to_jsonb_dumped = lambda value: Jsonb(value, dumps=lambda inner: json.dumps(inner, default=str)) if value is not None else None

    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                # One round trip to learn which of the requested Safes exist
                # and their current metadata snapshot (the audit "before"
                # side), instead of two sequential queries per Safe.
                await cursor.execute(
                    """SELECT s.safe_number, to_jsonb(m) AS data
                       FROM public.safes s
                       LEFT JOIN public.cyberark_safe_metadata m ON m.safe_number = s.safe_number
                       WHERE s.safe_number = ANY(%s)""",
                    (list(payload.safe_numbers),),
                )
                before_by_safe = {row["safe_number"]: row["data"] for row in await cursor.fetchall()}
                existing = [safe_number for safe_number in payload.safe_numbers if safe_number in before_by_safe]
                missing = [safe_number for safe_number in payload.safe_numbers if safe_number not in before_by_safe]

                if not existing:
                    return {"updated": 0, "updated_safe_numbers": [], "missing_safe_numbers": missing}

                insert_sql = (
                    f"INSERT INTO public.cyberark_safe_metadata ({', '.join(columns)}) "
                    f"VALUES {', '.join([row_template] * len(existing))} "
                    f"ON CONFLICT (safe_number) DO UPDATE SET {', '.join(conflict_updates)} RETURNING *"
                )
                insert_params: list = []
                for safe_number in existing:
                    insert_params += [safe_number, *base_values]
                await cursor.execute(insert_sql, tuple(insert_params))
                after_by_safe = {row["safe_number"]: row for row in await cursor.fetchall()}

                # One batched multi-row insert for every Safe's audit row,
                # instead of one INSERT per Safe.
                audit_row_template = "(%s, %s, %s, %s, %s, %s)"
                audit_sql = (
                    "INSERT INTO public.access_audit_log (actor_id, action, entity_type, entity_id, before_data, after_data) "
                    f"VALUES {', '.join([audit_row_template] * len(existing))}"
                )
                audit_params: list = []
                for safe_number in existing:
                    audit_params += [
                        actor_id, "bulk_update", "safe_assignment", str(safe_number),
                        to_jsonb_dumped(before_by_safe[safe_number]), to_jsonb_dumped(after_by_safe[safe_number]),
                    ]
                await cursor.execute(audit_sql, tuple(audit_params))

                # Same one-event-per-Safe behavior as before (preserved for
                # any consumer counting activity_events rows), batched into
                # a single insert.
                event_kind = _activity_event_kind("bulk_update", "safe_assignment")
                if event_kind is not None:
                    event_row_template = "(%s, %s)"
                    event_sql = f"INSERT INTO public.activity_events (kind, actor_id) VALUES {', '.join([event_row_template] * len(existing))}"
                    event_params: list = []
                    for _ in existing:
                        event_params += [event_kind, actor_id]
                    await cursor.execute(event_sql, tuple(event_params))

    return {"updated": len(existing), "updated_safe_numbers": existing, "missing_safe_numbers": missing}


async def count_retired_candidates(pool: AsyncConnectionPool):
    row = await fetch_one(pool, "SELECT count(*)::int AS total FROM public.safes WHERE lifecycle_status = 'retired'")
    return row["total"] if row else 0


async def list_safe_audit(pool: AsyncConnectionPool, safe_number: int, limit: int = 100):
    from app.db import fetch_all

    return await fetch_all(pool, """
        SELECT audit_id, actor_id, action, entity_type, entity_id,
               before_data, after_data, created_at
        FROM public.access_audit_log
        WHERE entity_id = %s
        ORDER BY created_at DESC, audit_id DESC
        LIMIT %s
    """, (str(safe_number), limit))


async def get_retired_candidates(pool: AsyncConnectionPool, limit: int = 100):
    from app.db import fetch_all

    return await fetch_all(pool, """
        SELECT s.safe_number, s.safe_name, s.safe_url_id, s.retired_at,
               count(sm.id)::int AS retired_member_count
        FROM public.safes s
        LEFT JOIN public.safe_members sm
          ON sm.safe_number = s.safe_number AND sm.lifecycle_status = 'retired'
        WHERE s.lifecycle_status = 'retired'
        GROUP BY s.safe_number, s.safe_name, s.safe_url_id, s.retired_at
        ORDER BY s.retired_at ASC NULLS FIRST, s.safe_number
        LIMIT %s
    """, (limit,))
