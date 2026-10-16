"""Strict public allowlist for live CyberArk Risk Management responses."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

from app.cyberark.risk_management.integrations.risk_management import RiskManagementClient

SOURCE = "cyberark_risk_management"


def _text(value: Any, limit: int = 1000) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value[:limit] if value else None


def _count(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def _count_map(value: Any) -> dict[str, int]:
    if not isinstance(value, dict):
        return {}
    return {
        key[:80]: count
        for key, raw in value.items()
        if isinstance(key, str) and (count := _count(raw)) is not None
    }


def public_summary(payload: Any) -> dict[str, Any]:
    payload = payload if isinstance(payload, dict) else {}
    entity_types = []
    for entity in payload.get("entityTypes", []):
        if not isinstance(entity, dict) or not (entity_type := _text(entity.get("entityTypeName"), 100)):
            continue
        categories = []
        for category in entity.get("categories", []):
            if not isinstance(category, dict) or not (name := _text(category.get("categoryName"), 160)):
                continue
            categories.append({"category": name, "severity_counts": _count_map(category.get("severityCounts"))})
        entity_types.append({"entity_type": entity_type, "categories": categories})
    return {
        "total_findings_by_severity": _count_map(payload.get("totalFindingsBySeverity")),
        "entity_types": entity_types,
    }


def public_risk_types(rows: Any) -> list[dict[str, Any]]:
    result = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict) or not (risk_type_id := _text(row.get("riskTypeId"), 200)):
            continue
        status_counts: dict[str, int] = {}
        for finding in row.get("findings", []):
            if isinstance(finding, dict) and (status := _text(finding.get("status"), 80)):
                if (count := _count(finding.get("count"))) is not None:
                    status_counts[status] = count
        result.append({
            "risk_type_id": risk_type_id,
            "name": _text(row.get("riskTypeName"), 300),
            "description": _text(row.get("riskTypeDescription"), 2000),
            "severity": _text(row.get("severity"), 40),
            "entity_type": _text(row.get("entityType"), 100),
            "open_findings": _count(row.get("openFindings")),
            "status_counts": status_counts,
            "updated_at": _text(row.get("updatedAt"), 80),
            "recommendation_types": [
                option[:200] for option in row.get("remediationOptions", [])
                if isinstance(option, str) and option.strip()
            ],
        })
    return result


def public_findings(rows: Any, include_entity_name: bool = False) -> list[dict[str, Any]]:
    result = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        finding_id = _text(row.get("findingId"), 200)
        risk_type_id = _text(row.get("riskTypeId"), 200)
        entity_id = _text(row.get("entityId"), 300)
        if not finding_id or not risk_type_id or not entity_id:
            continue
        result.append({
            "finding_id": finding_id,
            "risk_type_id": risk_type_id,
            "entity_id": entity_id,
            "entity_name": _text(row.get("entityDisplayName"), 300) if include_entity_name else None,
            "entity_type": _text(row.get("entityType"), 100),
            "severity": _text(row.get("severity"), 40),
            "status": _text(row.get("status"), 80),
            "first_detected_at": _text(row.get("createdAt"), 80),
            "last_detected_at": _text(row.get("updatedAt"), 80),
        })
    return result


def public_remediations(rows: Any) -> list[dict[str, Any]]:
    result = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict) or not (remediation_id := _text(row.get("id"), 200)):
            continue
        result.append({
            "remediation_id": remediation_id,
            "remediation_type": _text(row.get("remediationType"), 200),
            "entity_type": _text(row.get("entityType"), 100),
            "name": _text(row.get("name"), 500),
            "text": _text(row.get("remediationText"), 4000),
        })
    return result


def public_progress(payload: Any) -> dict[str, Any]:
    payload = payload if isinstance(payload, dict) else {}
    points = []
    for row in payload.get("progress", []):
        if not isinstance(row, dict) or not (date_at := _text(row.get("dateAt"), 80)):
            continue
        points.append({
            "date_at": date_at,
            "total_discovered": _count(row.get("totalDiscovered")),
            "total_onboarded": _count(row.get("totalOnboarded")),
        })
    return {
        "total_onboarded_current": _count(payload.get("totalOnboardedCurrent")),
        "total_onboarded_through_discovery_current": _count(payload.get("totalOnboardedThroughDiscoveryCurrent")),
        "points": points,
    }


async def get_public_overview(client: RiskManagementClient) -> dict[str, Any]:
    summary, risk_types, remediations, progress = await asyncio.gather(
        client.get_summary(), client.get_risk_types(), client.get_remediations(), client.get_progress()
    )
    return {
        "source": SOURCE,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "summary": public_summary(summary),
        "risk_types": public_risk_types(risk_types),
        "remediations": public_remediations(remediations),
        "progress": public_progress(progress),
        "recommendations_status": "catalog_options_only",
    }


async def get_public_findings(
    client: RiskManagementClient,
    limit: int,
    offset: int,
    include_entity_names: bool = False,
) -> dict[str, Any]:
    page = await client.get_findings_page(limit, offset)
    rows = public_findings(page["findings"], include_entity_name=include_entity_names)
    return {
        "source": SOURCE,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "rows": rows,
        "entity_names_visible": include_entity_names,
        "limit": limit,
        "offset": offset,
        "is_last_page": page["isLastPage"],
    }


async def get_public_all_findings(client: RiskManagementClient, include_entity_names: bool = False) -> dict[str, Any]:
    """Every finding (bounded by the client) for the grouped view; same allowlist as a page."""
    rows = public_findings(await client.get_all_findings(), include_entity_name=include_entity_names)
    return {
        "source": SOURCE,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "rows": rows,
        "entity_names_visible": include_entity_names,
        "complete": True,
    }
