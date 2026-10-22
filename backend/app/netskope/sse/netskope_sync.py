"""Synchronize Netskope as an isolated CMDB source, one run per scheduled task.

SYNC-TASK-001: inventory (users, devices, DEM), alert aggregates and DLP
capture are independent tasks of the same ``netskope`` source. Each has its own
run, cadence and backoff; only the inventory task reconciles (retires) records.
"""

from datetime import datetime, timedelta, timezone
from uuid import UUID
from collections.abc import Awaitable, Callable, Mapping
from typing import Any

from psycopg_pool import AsyncConnectionPool

from app.cross.cmdb_sync import sync_inventory_snapshot
from app.source_contract import RUN_PARTIAL_KEY
import asyncio
import logging

from app.netskope.sse.integrations.netskope import NetskopeClient, NetskopeError, NetskopeSettings, netskope_office_experience_configured
from app.netskope.sse.repositories.netskope_office_experience import office_spans_for_day, pending_office_days, replace_office_experience_day
from app.netskope.sse.services.netskope_office_experience import MEASURE_LOOKBACK_DAYS, build_spans, span_minutes
from app.netskope.sse.repositories.netskope_shared import ALERT_AGGREGATE_RETENTION_DAYS, POLICY_CAPTURE_MARKER, POLICY_CAPTURE_MARKER_VALUE
from app.netskope.sse.integrations.netskope_golden_release import GOLDEN_RELEASE_URL, fetch_golden_releases
from app.netskope.sse.repositories.netskope_golden_suggestion import save_golden_suggestion
from app.netskope.sse.repositories.netskope_uci import record_uci_company_snapshot, replace_netskope_user_uci
from app.netskope.sse.services.netskope_uci import build_uci_rows, previous_score
from app.netskope.sse.repositories.netskope_mutations import purge_netskope_alert_aggregates, record_alert_aggregates, record_device_snapshots, record_reported_counts
from app.netskope.sse.services.netskope_dlp_alerts import capture_netskope_dlp_alerts
from app.netskope.sse.services.netskope_mapping import (
    GROUP_MEMBERSHIP, GROUP_OBJECT_TYPE, POLICY_GROUP_OBJECT_TYPE, SOURCE_SYSTEM, map_netskope_dem_sites,
    map_netskope_group_memberships, map_netskope_groups, map_netskope_objects, map_netskope_policy_groups,
    netskope_deleted_user_ids,
)

from app.netskope.sse.services.netskope_rbac_mapping import (
    ADMIN_OBJECT_TYPE, ADMIN_ROLE_RELATIONSHIP, API_GROUP_OBJECT_TYPE, ROLE_OBJECT_TYPE,
    map_admin_roles, map_admins, map_api_groups,
)

ALERT_WINDOW_DAYS = (7, 30, 90)
# Severity is read live from AA; never capture another local severity snapshot.
# NSK-POL-001: `policy` is an observed-only dimension; the configured catalog
# is intentionally out of scope and never imported.
ALERT_DIMENSIONS = ("alert_type", "action", "policy")
# NSK-ALR-001: count-only snapshots are kept for 180 days, without individual
# history. Retention is time-based, not a reconciliation.


TASK_INVENTORY = "netskope_inventory"
TASK_ALERTS = "netskope_alerts"
TASK_DLP = "netskope_dlp"
TASK_UCI = "netskope_uci"
TASK_GOLDEN = "netskope_golden_release"
TASK_OFFICE_EXPERIENCE = "netskope_office_experience"
# NSK-EXP-OFFICE-001: a run measures at most this many pending days (backfill spreads over runs),
# spaces ADEM calls to stay under its 4 req/s and fails the day when too many calls fail.
OFFICE_DAYS_PER_RUN = 2
OFFICE_CALL_DELAY_SECONDS = 0.25
OFFICE_MAX_FAILED_SHARE = 0.1
UCI_COMPARISON_DAYS = 7

Progress = Callable[[str], Awaitable[None]] | None
LOGGER = logging.getLogger(__name__)


REPORTED_COUNT_KEYS = {
    "activeAccounts": "active_accounts", "inactiveAccounts": "inactive_accounts",
    "totalGroups": "total_groups", "totalOUs": "total_ous",
}
# Netskope really has ~0.7 % users whose accounts are all deleted; a much larger share means the payload changed
# meaning, and retiring them would empty the inventory.
MAX_DELETED_USER_SHARE = 0.2


def _is_count(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


async def _reported_counts(client: NetskopeClient) -> tuple[int, datetime | None, dict[str, int | None]] | None:
    """NSK-REF-001: the totals Netskope reports in its console header, or None when they cannot be read.

    They are only a reference shown beside Custodia's own counts, so any failure or odd value is dropped
    instead of failing the inventory run. Each optional total is kept only when it is a valid count.
    """
    try:
        counts = await client.get_user_counts()
    except NetskopeError:
        LOGGER.warning("Netskope users/counts no respondió; se omiten los totales de referencia")
        return None
    total = counts.get("totalUsers")
    if not _is_count(total):
        return None
    modified = counts.get("lastModified")
    when = None
    if isinstance(modified, (int, float)) and not isinstance(modified, bool) and modified > 0:
        try:
            when = datetime.fromtimestamp(modified, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            when = None
    extra = {column: counts[key] if _is_count(counts.get(key)) else None for key, column in REPORTED_COUNT_KEYS.items()}
    return total, when, extra


async def sync_netskope_inventory(pool: AsyncConnectionPool, run_id: UUID, progress: Progress = None) -> dict[str, int]:
    settings = NetskopeSettings.from_environment()
    dem_sites: list[dict[str, object]] | None = None
    async with NetskopeClient(settings) as client:
        if progress:
            await progress("Obteniendo usuarios Netskope")
        users = await client.get_users()
        reported = await _reported_counts(client)
        if progress:
            await progress("Obteniendo dispositivos Netskope")
        devices = await client.get_devices()
        if settings.dem_sites_path:
            if progress:
                await progress("Obteniendo sitios DEM Netskope")
            dem_sites = await client.get_dem_sites()
        groups: list[dict[str, object]] | None = None
        if settings.groups_path:
            # NSK-GRP-001 is an optional layer: if it fails, the users/devices
            # inventory still lands, but groups and memberships are neither
            # written nor reconciled, so nothing is retired from a failed read.
            if progress:
                await progress("Obteniendo grupos Netskope")
            try:
                groups = await client.get_groups()
            except NetskopeError:
                LOGGER.exception("Netskope getgroups falló; el inventario de grupos se conserva sin cambios")
        policy_groups: list[dict[str, object]] | None = None
        if settings.policy_groups_path:
            # NSK-POLICY-002 is optional like the groups layer: a failed read keeps the stored policy groups untouched.
            if progress:
                await progress("Obteniendo grupos de políticas Netskope")
            try:
                policy_groups = await client.get_policy_groups()
            except NetskopeError:
                LOGGER.exception("Netskope policygroups falló; los grupos de políticas se conservan sin cambios")
        rbac_read: tuple[list, dict, list, list] | None = None
        if settings.rbac_path:
            # NSK-RBAC-001 is optional like the groups layers: a failed or incomplete read keeps the stored
            # administrators, roles and page map untouched instead of retiring them.
            if progress:
                await progress("Obteniendo administradores y roles Netskope")
            try:
                roles = await client.get_admin_roles()
                details: dict[int, dict] = {}
                for role in roles:
                    await asyncio.sleep(settings.page_delay_seconds)
                    details[role["roleId"]] = await client.get_admin_role_detail(role["roleId"])
                rbac_read = (roles, details, await client.get_admin_users(), await client.get_api_group_pages())
            except (NetskopeError, KeyError):
                LOGGER.exception("Netskope RBAC falló; los administradores y roles se conservan sin cambios")
    if progress:
        await progress("Validando snapshot Netskope")
    objects = map_netskope_objects(users, devices)
    deleted_ids = netskope_deleted_user_ids(users)
    deleted_users = len(deleted_ids)
    if reported is not None:
        # Netskope's total counts live rows; Custodia counts distinct ids. The exact gap is the live rows repeated.
        live_ids = [str(user.get("id")) for user in users if str(user.get("id")) not in deleted_ids]
        reported = (reported[0], reported[1], {**reported[2], "repeated_user_rows": len(live_ids) - len(set(live_ids))})
    distinct_users = len({user.get("id") for user in users})
    if distinct_users and deleted_users / distinct_users > MAX_DELETED_USER_SHARE:
        raise ValueError(f"Netskope marcó {deleted_users} de {distinct_users} usuarios con todas sus cuentas borradas; se descarta la lectura")
    relationships = []
    group_outcome: dict[str, int] = {}
    if settings.groups_path:
        if groups is None:
            group_outcome = {"groups_error": 1, RUN_PARTIAL_KEY: 1}
        else:
            group_objects = map_netskope_groups(groups)
            relationships, unresolved = map_netskope_group_memberships(
                users, {item.source_id for item in group_objects},
            )
            accounts_missing = bool(users) and not any(isinstance(user.get("accounts"), list) for user in users)
            if accounts_missing or (not group_objects and (relationships or unresolved)):
                # Users carry no accounts[] (membership unreadable) or reference groups
                # while the listing is empty: an inconsistent read must not retire
                # the stored groups or memberships.
                group_outcome = {"groups_error": 1, RUN_PARTIAL_KEY: 1}
                relationships, groups = [], None
            else:
                objects.extend(group_objects)
                group_outcome = {"groups": len(group_objects), "group_unresolved_references": unresolved}
    policy_outcome: dict[str, int] = {}
    if settings.policy_groups_path:
        policy_objects = None
        if policy_groups is not None:
            try:
                policy_objects = map_netskope_policy_groups(policy_groups)
            except ValueError:
                LOGGER.exception("Netskope policygroups devolvió grupos inválidos; se conservan los almacenados")
        if policy_objects is None:
            policy_groups = None
            policy_outcome = {"policy_groups_error": 1, RUN_PARTIAL_KEY: 1}
        else:
            objects.extend(policy_objects)
            policy_outcome = {"policy_groups": len(policy_objects)}
    rbac_outcome: dict[str, int] = {}
    rbac_relationships: list = []
    if settings.rbac_path:
        rbac_objects = None
        if rbac_read is not None:
            try:
                role_objects = map_admin_roles(rbac_read[0], rbac_read[1])
                admin_objects, rbac_relationships, unresolved_roles = map_admins(
                    rbac_read[2], {item.source_id for item in role_objects},
                )
                group_page_objects = map_api_groups(rbac_read[3])
                rbac_objects = role_objects + admin_objects + group_page_objects
            except ValueError:
                LOGGER.exception("Netskope RBAC devolvió datos inválidos; se conservan los almacenados")
        if rbac_objects is None:
            rbac_read, rbac_relationships = None, []
            rbac_outcome = {"rbac_error": 1, RUN_PARTIAL_KEY: 1}
        else:
            objects.extend(rbac_objects)
            rbac_outcome = {
                "admin_roles": len(role_objects), "admins": len(admin_objects),
                "api_groups": len(group_page_objects), "admin_unresolved_roles": unresolved_roles,
            }
    if dem_sites is not None:
        objects.extend(map_netskope_dem_sites(dem_sites))
    if progress:
        await progress("Persistiendo inventario Netskope")
    # Snapshots go first: if they fail, the run fails before the inventory
    # upsert retires anything. Snapshots of a failed run are never compared,
    # since the changes view only reads completed runs.
    await record_device_snapshots(
        pool,
        run_id,
        [
            {"source_id": item.source_id, "attributes": item.attributes}
            for item in objects
            if item.object_type == "device"
        ],
    )
    reconcile_types = {"user", "device", "dem_site"} if dem_sites is not None else {"user", "device"}
    if groups is not None:
        reconcile_types.add(GROUP_OBJECT_TYPE)
    if policy_groups is not None:
        reconcile_types.add(POLICY_GROUP_OBJECT_TYPE)
    reconcile_relationships = {GROUP_MEMBERSHIP} if groups is not None else set()
    if rbac_read is not None:
        reconcile_types.update({ROLE_OBJECT_TYPE, ADMIN_OBJECT_TYPE, API_GROUP_OBJECT_TYPE})
        reconcile_relationships.add(ADMIN_ROLE_RELATIONSHIP)
    result = await sync_inventory_snapshot(
        pool, objects, relationships + rbac_relationships, source_run_id=str(run_id),
        reconcile_object_types=frozenset(reconcile_types),
        reconcile_relationship_types=frozenset(reconcile_relationships),
        source_system=SOURCE_SYSTEM,
        retire_orphan_relationships=True,
    )
    if reported is not None:
        try:
            await record_reported_counts(pool, run_id, *reported)
        except Exception:
            # A reference number must never fail a run whose inventory already landed.
            LOGGER.exception("No se pudo guardar el total de usuarios que informa Netskope")
    return {**result, **group_outcome, **policy_outcome, **rbac_outcome, "users_all_accounts_deleted": deleted_users}


async def sync_netskope_alerts(pool: AsyncConnectionPool, run_id: UUID, progress: Progress = None) -> dict[str, int]:
    """Count-only alert snapshots; never touches or retires inventory."""
    settings = NetskopeSettings.from_environment()
    if not settings.alert_path:
        raise ValueError("NETSKOPE_ALERT_PATH no está configurado")
    alert_aggregates: list[dict[str, object]] = []
    async with NetskopeClient(settings) as client:
        alert_window_end = datetime.now(timezone.utc)
        for window_days in ALERT_WINDOW_DAYS:
            window_start = alert_window_end - timedelta(days=window_days)
            starttime = int(window_start.timestamp())
            endtime = int(alert_window_end.timestamp())
            if progress:
                await progress(f"Agregando alertas Netskope · {window_days} días")
            total = await client.get_alert_aggregates(starttime, endtime)
            alert_aggregates.append({
                "window_days": window_days, "window_start": window_start, "window_end": alert_window_end,
                "dimension": "total", "dimension_value": "", "alert_count": sum(item["count"] for item in total),
            })
            for dimension in ALERT_DIMENSIONS:
                rows = await client.get_alert_aggregates(starttime, endtime, dimension)
                alert_aggregates.extend({
                    "window_days": window_days, "window_start": window_start, "window_end": alert_window_end,
                    "dimension": dimension,
                    "dimension_value": str(item["key"]).strip() or "Sin dato",
                    "alert_count": item["count"],
                } for item in rows)
            # NSK-POL-002: every dimension request above succeeded, so an empty
            # policy list means "no policy fired", not "never captured".
            alert_aggregates.append({
                "window_days": window_days, "window_start": window_start, "window_end": alert_window_end,
                "dimension": POLICY_CAPTURE_MARKER, "dimension_value": POLICY_CAPTURE_MARKER_VALUE, "alert_count": 0,
            })
    if progress:
        await progress("Persistiendo agregados de alertas Netskope")
    await record_alert_aggregates(pool, run_id, alert_aggregates)
    # NSK-ALR-001: expired snapshots are removed after every run that wrote
    # aggregates, mirroring the DLP retention. Run history and any other
    # reference stay untouched; only aged-out children are deleted.
    await purge_netskope_alert_aggregates(pool, ALERT_AGGREGATE_RETENTION_DAYS)
    return {"objects": len(alert_aggregates), "relationships": 0}


async def sync_netskope_dlp(pool: AsyncConnectionPool, run_id: UUID, progress: Progress = None) -> dict[str, int]:
    """NSK-DLP-001 capture as its own task: a failure fails only this run."""
    dlp = await capture_netskope_dlp_alerts(pool, run_id, progress)
    if dlp.get("error"):
        # Previously committed pages stay available and pending ones replay on
        # the next run; failing here gives the task its own visible backoff.
        raise RuntimeError("La captura DLP de Netskope terminó con error")
    return {
        "objects": int(dlp["captured_alerts"]),
        "relationships": 0,
        "dlp_persistence_ms": int(dlp.get("persistence_ms", 0)),
        "dlp_wait_ms": int(dlp.get("wait_ms", 0)),
        "dlp_requests": int(dlp.get("requests", 0)),
        "dlp_retries": int(dlp.get("retries", 0)),
        "dlp_pages": int(dlp.get("pages", 0)),
        "dlp_elapsed_ms": int(dlp.get("elapsed_ms", 0)),
        "dlp_lag_seconds": int(dlp.get("lag_seconds", 0)),
        "dlp_scanned_events": int(dlp["scanned_events"]),
        "dlp_alerts_captured": int(dlp["captured_alerts"]),
        "dlp_capture_partial": int(bool(dlp["partial"])),
        "dlp_capture_error": 0,
        "dlp_idle": int(bool(dlp.get("idle"))),
        # A bounded capture that has not caught up ends as "partial" so the run
        # history says so instead of reporting a complete capture.
        RUN_PARTIAL_KEY: int(bool(dlp["partial"])),
    }


async def sync_netskope_uci(pool: AsyncConnectionPool, run_id: UUID, progress: Progress = None) -> dict[str, int]:
    """NSK-UBA-002: latest Poor/Moderate UCI per user; never touches inventory.

    The table is replaced only after both ratings and the history batches were
    read completely. Any failure raises, so the previous scores stay in place
    (their age shows in the task freshness) instead of being half-replaced.
    """
    settings = NetskopeSettings.from_environment()
    if not settings.uci_path:
        raise ValueError("NETSKOPE_UCI_PATH no está configurado")
    async with NetskopeClient(settings) as client:
        if progress:
            await progress("Obteniendo usuarios con UCI bajo o moderado")
        ranked = await client.get_ranked_uci()
        rows, rejected = build_uci_rows(ranked)
        history: dict[str, list[dict[str, object]]] = {}
        if rows:
            if progress:
                await progress("Obteniendo el UCI de hace una semana")
            now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
            history = await client.get_uci_history(
                [row["email_key"] for row in rows],
                now_ms - UCI_COMPARISON_DAYS * 24 * 3600 * 1000, now_ms,
            )
    for row in rows:
        row["previous_score"] = previous_score(history.get(row["email_key"], []), row["scored_ms"])
    if progress:
        await progress("Persistiendo UCI Netskope")
    await replace_netskope_user_uci(pool, run_id, rows)
    try:
        await record_uci_company_snapshot(pool)
    except Exception:  # noqa: BLE001 - weekly counts are a convenience; the UCI capture already succeeded
        LOGGER.warning("No se pudo registrar el conteo semanal de UCI por empresa", exc_info=True)
    return {"objects": len(rows), "relationships": 0, "uci_rejected_rows": rejected}


async def sync_netskope_office_experience(pool: AsyncConnectionPool, run_id: UUID, progress: Progress = None) -> dict[str, int]:
    """NSK-EXP-OFFICE-001: ADEM score of each office-goer's office and remote span, per complete UTC day.

    Measures the oldest pending days of the last MEASURE_LOOKBACK_DAYS. A day is stored and marked
    complete in one transaction; if more than OFFICE_MAX_FAILED_SHARE of its calls fail, the run fails
    and the day stays pending for the next run. A failed single call is "Sin dato", never a score.
    """
    if not netskope_office_experience_configured():
        raise ValueError("NETSKOPE_OFFICE_EXPERIENCE_PATH no está configurado")
    today = datetime.now(timezone.utc).date()
    days = (await pending_office_days(pool, today - timedelta(days=MEASURE_LOOKBACK_DAYS), today - timedelta(days=1)))[:OFFICE_DAYS_PER_RUN]
    people = calls = failed_total = 0
    async with NetskopeClient(NetskopeSettings.from_environment()) as client:
        for day in days:
            if progress:
                await progress(f"Midiendo experiencia en oficina del {day.isoformat()}")
            spans = build_spans(await office_spans_for_day(pool, day))
            rows, day_calls, failed = [], 0, 0
            for email, by_status in sorted(spans.items()):
                row = {"email": email, "office_minutes": 0, "office_score": None, "remote_minutes": 0, "remote_score": None}
                for status, prefix in (("on-prem", "office"), ("off-prem", "remote")):
                    if status not in by_status:
                        continue
                    start, end = by_status[status]
                    row[f"{prefix}_minutes"] = span_minutes(start, end)
                    day_calls += 1
                    try:
                        row[f"{prefix}_score"] = await client.get_adem_user_score(email, int(start.timestamp()), int(end.timestamp()))
                    except NetskopeError:
                        failed += 1
                    await asyncio.sleep(OFFICE_CALL_DELAY_SECONDS)
                rows.append(row)
            if day_calls and failed > max(2, day_calls * OFFICE_MAX_FAILED_SHARE):
                raise NetskopeError(f"ADEM falló en {failed} de {day_calls} consultas del {day.isoformat()}; el día queda pendiente")
            await replace_office_experience_day(pool, run_id, day, rows, failed)
            people += len(rows)
            calls += day_calls
            failed_total += failed
    return {"objects": people, "relationships": 0, "office_days_measured": len(days), "office_calls": calls, "office_failed_calls": failed_total}


async def sync_netskope_golden_release(pool: AsyncConnectionPool, run_id: UUID, progress: Progress = None) -> dict[str, int]:
    """NSK-GOLDEN-001: store the documented golden pair as a suggestion; baselines and inventory stay untouched."""
    if progress:
        await progress("Leyendo las releases golden de la documentación de Netskope")
    releases = await fetch_golden_releases()
    await save_golden_suggestion(pool, releases, GOLDEN_RELEASE_URL, run_id)
    return {"objects": len(releases), "relationships": 0}


_TASKS = {
    TASK_INVENTORY: sync_netskope_inventory, TASK_ALERTS: sync_netskope_alerts,
    TASK_DLP: sync_netskope_dlp, TASK_UCI: sync_netskope_uci,
    TASK_GOLDEN: sync_netskope_golden_release, TASK_OFFICE_EXPERIENCE: sync_netskope_office_experience,
}


async def dispatch_netskope_run(pool: AsyncConnectionPool, run: Mapping[str, Any], progress: Progress = None) -> dict[str, int]:
    """Route a claimed run to its task; runs queued before 078 are inventory."""
    task = _TASKS.get(run.get("task_key") or TASK_INVENTORY)
    if task is None:
        raise ValueError(f"Tarea Netskope no admitida: {run.get('task_key')}")
    return await task(pool, run["run_id"], progress)
