"""CONN-001/v1 classification and freshness contract."""

from datetime import datetime, timezone

from psycopg_pool import AsyncConnectionPool

from app.cross.repositories.person_client_coverage import (
    IDENTITY_SOURCE_FILE,
    IDENTITY_SOURCE_SYSTEM,
    NETSKOPE_SOURCE_FILE,
    NETSKOPE_SOURCE_SYSTEM,
    PERSON_FRESHNESS_HOURS,
    get_person_client_coverage_snapshot,
)

METRIC_CODE = "CONN-001"
METRIC_VERSION = "1"
DEVICE_FRESHNESS_DAYS = 7
SOURCE_CONTRACTS = {
    "identity": (IDENTITY_SOURCE_SYSTEM, IDENTITY_SOURCE_FILE),
    "netskope": (NETSKOPE_SOURCE_SYSTEM, NETSKOPE_SOURCE_FILE),
}


def _source_metadata(row: dict | None, *, source_system: str, source_file: str, now: datetime) -> dict:
    freshness = "missing"
    age_hours = None
    if row:
        completed_at = row.get("completed_at")
        if row.get("status") != "completed" or completed_at is None:
            freshness = "incomplete"
        else:
            measured = completed_at if completed_at.tzinfo else completed_at.replace(tzinfo=timezone.utc)
            age_seconds = (now - measured).total_seconds()
            age_hours = round(age_seconds / 3600, 2)
            freshness = "fresh" if 0 <= age_seconds <= PERSON_FRESHNESS_HOURS * 3600 else "stale"
    return {
        "source_system": source_system,
        "source_file": source_file,
        "run_id": row.get("run_id") if row else None,
        "status": row.get("status") if row else None,
        "started_at": row.get("started_at") if row else None,
        "completed_at": row.get("completed_at") if row else None,
        "freshness": freshness,
        "age_hours": age_hours,
    }


def _classify(row: dict, sources_fresh: bool) -> str:
    if not sources_fresh or row["identity_records"] != 1 or row["netskope_users"] != 1:
        return "unknown"
    if row["devices_ambiguous"]:
        return "unknown"
    recent = row["devices_recent"]
    stale = row["devices_not_recent"]
    if recent and not stale:
        return "covered"
    if recent and stale:
        return "partial"
    return "gap"


def build_person_client_coverage(
    rows: list[dict], runs: dict[str, dict | None], *, now: datetime | None = None,
) -> tuple[dict, list[dict]]:
    """Build summary and selected-person rows from DB evidence, not heuristics."""
    current = now or datetime.now(timezone.utc)
    sources = {
        key: _source_metadata(
            runs.get(source_system), source_system=source_system,
            source_file=source_file, now=current,
        )
        for key, (source_system, source_file) in SOURCE_CONTRACTS.items()
    }
    sources_fresh = all(source["freshness"] == "fresh" for source in sources.values())
    classified = [{**row, "status": _classify(row, sources_fresh)} for row in rows]
    counts = {status: 0 for status in ("covered", "partial", "gap", "unknown")}
    for row in classified:
        counts[row["status"]] += 1
    denominator = len(classified)
    covered = counts["covered"]
    devices_recent = sum(
        row["devices_recent"]
        for row in classified
        if row["identity_records"] == 1 and row["netskope_users"] == 1
    )
    devices_total = sum(
        row["devices_recent"] + row["devices_not_recent"]
        for row in classified
        if row["identity_records"] == 1 and row["netskope_users"] == 1
    )
    summary = {
        "metric_code": METRIC_CODE,
        "metric_version": METRIC_VERSION,
        "label": "Cliente Netskope activo y observado recientemente",
        "population": "Usuarios humanos activos de Identity Administration",
        "person_freshness_hours": PERSON_FRESHNESS_HOURS,
        "device_freshness_days": DEVICE_FRESHNESS_DAYS,
        "counts": {
            "denominator": denominator,
            **counts,
            "coverage_percent": round(covered * 100 / denominator, 2) if denominator and sources_fresh else None,
            "devices_recent": devices_recent,
            "devices_total": devices_total,
            "device_coverage_percent": round(devices_recent * 100 / devices_total, 2)
            if devices_total and sources_fresh else None,
        },
        "sources": sources,
    }
    return summary, classified


async def get_person_client_coverage(pool: AsyncConnectionPool) -> dict:
    snapshot = await get_person_client_coverage_snapshot(pool)
    summary, _ = build_person_client_coverage(snapshot["rows"], snapshot["runs"])
    return summary


async def get_person_client_coverage_detail(pool: AsyncConnectionPool, *, email: str) -> dict:
    snapshot = await get_person_client_coverage_snapshot(pool, email=email)
    summary, classified = build_person_client_coverage(snapshot["rows"], snapshot["runs"])
    if not classified:
        sources_fresh = all(source["freshness"] == "fresh" for source in summary["sources"].values())
        status = "not_applicable" if sources_fresh else "unknown"
        return {
            "metric_code": METRIC_CODE, "metric_version": METRIC_VERSION,
            "email": email, "status": status, "identity_records": 0,
            "netskope_users": 0, "devices_recent": 0, "devices_not_recent": 0,
            "devices_total": 0, "devices_ambiguous": 0,
            "sources": summary["sources"],
            "explanation": "La dirección no pertenece a la población elegible de Identity Administration."
            if status == "not_applicable" else "No hay evidencia de fuente completa y vigente para resolver la población.",
        }
    row = classified[0]
    explanation = {
        "covered": "Todos los dispositivos activos vinculados son recientes (últimos 7 días).",
        "partial": "Hay dispositivos activos recientes y otros no recientes o sin fecha; esto no confirma su antigüedad.",
        "gap": "El vínculo es único, pero no hay dispositivos activos recientes.",
        "unknown": "El vínculo o la evidencia de fuente es ambiguo, incompleto o no vigente.",
    }[row["status"]]
    return {
        "metric_code": METRIC_CODE, "metric_version": METRIC_VERSION,
        "email": email, "status": row["status"],
        "identity_records": row["identity_records"], "netskope_users": row["netskope_users"],
        "devices_recent": row["devices_recent"], "devices_not_recent": row["devices_not_recent"],
        "devices_total": row["devices_recent"] + row["devices_not_recent"],
        "devices_ambiguous": row["devices_ambiguous"],
        "sources": summary["sources"],
        "explanation": explanation,
    }
