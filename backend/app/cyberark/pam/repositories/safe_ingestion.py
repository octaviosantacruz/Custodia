"""SQL de la ingesta de Safes y miembros (ARCH-LAYERS-001).

Las escrituras por Safe viven en su propia transacción y la metadata local se
crea sin sobrescribir decisiones humanas. La reconciliación de ausentes debe
invocarse sólo tras una captura completa y exitosa.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

INSERT_RAW = """
    INSERT INTO public.raw_safe_members_dump (source_run_id, safe_name, raw_payload)
    VALUES (%s, %s, %s)
"""

UPSERT_SAFE = """
    INSERT INTO public.safes (
      safe_number, safe_name, safe_url_id, location,
      creator_id, creator_name, olac_enabled,
      number_of_versions_retention, number_of_days_retention, auto_purge_enabled,
      creation_time, last_modification_time, description, managing_cpm,
      is_expired_member, source_run_id
    ) VALUES (
      %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
      epoch_to_timestamptz(%s), epoch_to_timestamptz(%s), %s, %s, %s, %s
    )
    ON CONFLICT (safe_number) DO UPDATE SET
      safe_name = EXCLUDED.safe_name,
      safe_url_id = EXCLUDED.safe_url_id,
      location = EXCLUDED.location,
      creator_id = EXCLUDED.creator_id,
      creator_name = EXCLUDED.creator_name,
      olac_enabled = EXCLUDED.olac_enabled,
      number_of_versions_retention = EXCLUDED.number_of_versions_retention,
      number_of_days_retention = EXCLUDED.number_of_days_retention,
      auto_purge_enabled = EXCLUDED.auto_purge_enabled,
      creation_time = EXCLUDED.creation_time,
      last_modification_time = EXCLUDED.last_modification_time,
      description = EXCLUDED.description,
      managing_cpm = EXCLUDED.managing_cpm,
      is_expired_member = EXCLUDED.is_expired_member,
      lifecycle_status = 'active',
      retired_at = NULL,
      last_seen_at = now(),
      source_run_id = EXCLUDED.source_run_id
    RETURNING (xmax = 0) AS inserted
"""

ENSURE_SAFE_METADATA = """
    INSERT INTO public.cyberark_safe_metadata (safe_number)
    VALUES (%s)
    ON CONFLICT (safe_number) DO NOTHING
"""

UPSERT_NORMALIZED_SAFE = """
    INSERT INTO public.cyberark_inventory_objects (
      source_system, object_type, source_id, display_name, lifecycle_status,
      source_run_id, attributes
    ) VALUES ('cyberark', 'safe', %s, %s, 'active', %s, %s)
    ON CONFLICT (source_system, object_type, source_id) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      lifecycle_status = 'active',
      last_seen_at = now(),
      source_run_id = EXCLUDED.source_run_id,
      attributes = EXCLUDED.attributes,
      updated_at = now()
"""

UPSERT_MEMBER = """
    INSERT INTO public.safe_members (
      safe_number, member_id, member_name, member_type,
      membership_expiration_date, is_expired_membership_enable,
      is_predefined_user, is_read_only, permissions, source_run_id
    ) VALUES (
      %s, %s, %s, %s, epoch_to_timestamptz(%s), %s, %s, %s, %s, %s
    )
    ON CONFLICT (safe_number, member_id) DO UPDATE SET
      member_name = EXCLUDED.member_name,
      member_type = EXCLUDED.member_type,
      membership_expiration_date = EXCLUDED.membership_expiration_date,
      is_expired_membership_enable = EXCLUDED.is_expired_membership_enable,
      is_predefined_user = EXCLUDED.is_predefined_user,
      is_read_only = EXCLUDED.is_read_only,
      permissions = EXCLUDED.permissions,
      lifecycle_status = 'active',
      retired_at = NULL,
      last_seen_at = now(),
      source_run_id = EXCLUDED.source_run_id
    RETURNING (xmax = 0) AS inserted
"""

MARK_STALE_MEMBERS = """
    UPDATE public.safe_members
    SET lifecycle_status = 'retired', retired_at = COALESCE(retired_at, now())
    WHERE source_run_id IS DISTINCT FROM %s
      AND lifecycle_status = 'active'
"""

MARK_STALE_MEMBERS_FOR_SAFE = """
    UPDATE public.safe_members
    SET lifecycle_status = 'retired', retired_at = COALESCE(retired_at, now())
    WHERE safe_number = %s
      AND source_run_id IS DISTINCT FROM %s
      AND lifecycle_status = 'active'
"""

MARK_STALE_NORMALIZED_SAFES = """
    UPDATE public.cyberark_inventory_objects
    SET lifecycle_status = 'retired', updated_at = now()
    WHERE source_system = 'cyberark' AND object_type = 'safe'
      AND source_run_id IS DISTINCT FROM %s
      AND lifecycle_status = 'active'
"""

MARK_STALE_SAFES = """
    UPDATE public.safes
    SET lifecycle_status = 'retired', retired_at = COALESCE(retired_at, now())
    WHERE source_run_id IS DISTINCT FROM %s
      AND lifecycle_status = 'active'
"""


async def store_raw_entry(conn: Any, run_id: UUID, safe_name: str | None, entry: dict[str, Any]) -> None:
    """Append the raw snapshot and commit it, so it survives a later validation failure."""
    await conn.execute(INSERT_RAW, (run_id, safe_name, Jsonb(entry)))
    await conn.commit()


async def persist_safe_entry(conn: Any, run_id: UUID, entry: dict[str, Any], location: Any, reconcile_complete: bool) -> dict[str, Any]:
    """Upsert one validated Safe and its members in a single transaction."""
    safe_data = entry["safeData"]
    members = entry["members"]
    async with conn.transaction():
        safe_cursor = await conn.execute(UPSERT_SAFE, (
            safe_data["safeNumber"], safe_data["safeName"], safe_data["safeUrlId"], location,
            (safe_data.get("creator") or {}).get("id"), (safe_data.get("creator") or {}).get("name"),
            safe_data.get("olacEnabled"), safe_data.get("numberOfVersionsRetention"),
            safe_data.get("numberOfDaysRetention"), safe_data.get("autoPurgeEnabled"),
            safe_data.get("creationTime"), safe_data.get("lastModificationTime"),
            safe_data.get("description"), safe_data.get("managingCPM"),
            safe_data.get("isExpiredMember"), run_id,
        ))
        safe_row = await safe_cursor.fetchone()
        await conn.execute(ENSURE_SAFE_METADATA, (safe_data["safeNumber"],))
        await conn.execute(UPSERT_NORMALIZED_SAFE, (
            str(safe_data["safeNumber"]), safe_data["safeName"], run_id,
            Jsonb({"safe_url_id": safe_data["safeUrlId"]}),
        ))
        inserted_members = 0
        updated_members = 0
        if members:
            member_params = [
                (
                    member["safeNumber"], member["memberId"], member["memberName"], member["memberType"],
                    member["membershipExpirationDate"], member.get("isExpiredMembershipEnable"),
                    member.get("isPredefinedUser"), member.get("isReadOnly"), Jsonb(member["permissions"]), run_id,
                )
                for member in members
            ]
            async with conn.cursor() as member_cursor:
                await member_cursor.executemany(UPSERT_MEMBER, member_params, returning=True)
                # executemany(returning=True) yields one result set per
                # statement, in submission order, so this stays aligned
                # with `members` without re-matching by member id.
                for _ in members:
                    if (await member_cursor.fetchone())["inserted"]:
                        inserted_members += 1
                    else:
                        updated_members += 1
                    member_cursor.nextset()
        if reconcile_complete:
            await conn.execute(MARK_STALE_MEMBERS_FOR_SAFE, (safe_data["safeNumber"], run_id))
    return {
        "safe_inserted": bool(safe_row["inserted"]),
        "members_inserted": inserted_members,
        "members_updated": updated_members,
        "member_count": len(members),
    }


async def retire_stale_inventory(pool: AsyncConnectionPool, run_id: UUID) -> tuple[int, int]:
    """Retire members/Safes absent from a complete run; returns (members, safes) retired."""
    async with pool.connection() as conn:
        async with conn.transaction():
            member_cursor = await conn.execute(MARK_STALE_MEMBERS, (run_id,))
            safe_cursor = await conn.execute(MARK_STALE_SAFES, (run_id,))
            await conn.execute(MARK_STALE_NORMALIZED_SAFES, (run_id,))
            return member_cursor.rowcount, safe_cursor.rowcount
