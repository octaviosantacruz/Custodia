"""Shared seeding helpers for Netskope Postgres integration tests.

Only ever used against the disposable CUSTODIA_TEST_DATABASE_URL database
(see tests/support/pg_integration_base.py); every test wipes source_system
'netskope' rows before and after itself."""

import json


async def reset_netskope(pool) -> None:
    async with pool.connection() as conn:
        await conn.execute("DELETE FROM public.netskope_device_reviews")
        await conn.execute("DELETE FROM public.netskope_device_snapshots")
        await conn.execute("DELETE FROM public.netskope_alert_aggregates")
        await conn.execute("DELETE FROM public.netskope_dlp_alerts")
        await conn.execute("DELETE FROM public.netskope_dlp_capture_state")
        await conn.execute("""DELETE FROM public.cyberark_inventory_relationships WHERE source_object_id IN (
            SELECT object_id FROM public.cyberark_inventory_objects WHERE source_system = 'netskope')
            OR target_object_id IN (SELECT object_id FROM public.cyberark_inventory_objects WHERE source_system = 'netskope')""")
        await conn.execute("DELETE FROM public.cyberark_inventory_objects WHERE source_system = 'netskope'")


async def seed_netskope_user(pool, source_id: str, display_name: str, email: str = "", *, lifecycle_status: str = "active", extra: dict | None = None) -> int:
    async with pool.connection() as conn:
        cursor = await conn.execute(
            """INSERT INTO public.cyberark_inventory_objects
                   (source_system, object_type, source_id, display_name, lifecycle_status, attributes)
               VALUES ('netskope', 'user', %s, %s, %s, %s::jsonb)
               RETURNING object_id""",
            (source_id, display_name, lifecycle_status, json.dumps({"email": email, **(extra or {})})),
        )
        row = await cursor.fetchone()
        return row["object_id"]


async def seed_dlp_alert(
    pool,
    incident_id: str,
    event_timestamp,
    *,
    status: str = "open",
    severity: str = "High",
    policy: str = "Policy A",
    action: str = "alert",
    user_id: str = "",
) -> None:
    async with pool.connection() as conn:
        await conn.execute(
            """INSERT INTO public.netskope_dlp_alerts
                   (incident_id, event_timestamp, status, severity, policy, action, user_id)
               VALUES (%s, %s, %s, %s, %s, %s, %s)""",
            (incident_id, event_timestamp, status, severity, policy, action, user_id),
        )


async def seed_device(pool, source_id: str, attributes: dict, *, lifecycle_status: str = "active", object_type: str = "device") -> int:
    async with pool.connection() as conn:
        cursor = await conn.execute(
            """INSERT INTO public.cyberark_inventory_objects
                   (source_system, object_type, source_id, display_name, lifecycle_status, attributes)
               VALUES ('netskope', %s, %s, %s, %s, %s::jsonb)
               RETURNING object_id""",
            (object_type, source_id, attributes.get("hostname") or source_id, lifecycle_status, json.dumps(attributes)),
        )
        row = await cursor.fetchone()
        return row["object_id"]


async def seed_run(pool, run_id, status: str, started_at) -> None:
    async with pool.connection() as conn:
        await conn.execute(
            """INSERT INTO public.cyberark_ingestion_runs (run_id, status, source_system, started_at, triggered_by)
               VALUES (%s, %s, 'netskope', %s, 'test-suite')""",
            (run_id, status, started_at),
        )


async def seed_snapshot(pool, run_id, device_id: str, attributes: dict, captured_at) -> None:
    async with pool.connection() as conn:
        await conn.execute(
            """INSERT INTO public.netskope_device_snapshots (source_run_id, device_id, captured_at, attributes)
               VALUES (%s, %s, %s, %s::jsonb)""",
            (run_id, device_id, captured_at, json.dumps(attributes)),
        )


async def reset_netskope_runs(pool) -> None:
    async with pool.connection() as conn:
        await conn.execute("DELETE FROM public.netskope_device_snapshots")
        await conn.execute("DELETE FROM public.netskope_reported_counts")
        await conn.execute("DELETE FROM public.cyberark_ingestion_runs WHERE source_system = 'netskope' AND triggered_by = 'test-suite'")


async def insert_netskope_run(pool, status: str = "completed", *, hours: float = 1, source_file: str = "netskope-api"):
    """A Netskope inventory run that started and ended `hours` ago (tagged so reset_netskope_runs removes it)."""
    from datetime import datetime, timedelta, timezone
    from uuid import uuid4

    moment = datetime.now(timezone.utc) - timedelta(hours=hours)
    run_id = uuid4()
    async with pool.connection() as conn:
        await conn.execute(
            """INSERT INTO public.cyberark_ingestion_runs
                   (run_id, status, source_system, source_file, started_at, completed_at, triggered_by)
               VALUES (%s, %s, 'netskope', %s, %s, %s, 'test-suite')""",
            (run_id, status, source_file, moment, moment),
        )
    return run_id


async def seed_device_review(pool, object_id: int, fields: dict, actor_id: str = "test-suite") -> None:
    """Seed a historical stored decision, without reviving the retired write path.

    Values are explicit test data and remain subject to migration 085's
    constraints. This fixture does not validate, infer evidence or audit.
    """
    async with pool.connection() as conn:
        await conn.execute(
            """INSERT INTO public.netskope_device_reviews
                   (object_id, diagnosis, status, owner, reference, note,
                    exception_expires_at, next_review_at, evidence, decided_by)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)""",
            (object_id, fields["diagnosis"], fields.get("status", "pending"),
             fields.get("owner"), fields.get("reference"), fields.get("note"),
             fields.get("exception_expires_at"), fields.get("next_review_at"),
             json.dumps(fields.get("evidence", {})), actor_id),
        )
