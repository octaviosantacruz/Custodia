"""Findings use cases (ARCH-LAYERS-002).

The service owns the order of steps and the audit row of each finding change;
the route only validates the HTTP input and maps domain errors.
"""

from __future__ import annotations

from datetime import date, datetime
from psycopg_pool import AsyncConnectionPool

from app.cross.repositories.audit import record_audit
from app.cyberark.pam.repositories.findings import get_finding, list_findings, refresh_findings, update_finding


class FindingNotFoundError(Exception):
    """The finding does not exist."""


class ExceptionReasonRequiredError(Exception):
    """An ``excepted`` status needs a reason."""


async def search_findings(
    pool: AsyncConnectionPool, status: str, rule_id: str, severity: str, limit: int, offset: int, include_internal: bool,
) -> dict:
    return await list_findings(pool, status, rule_id, severity, limit, offset, include_internal)


async def refresh_current_findings(pool: AsyncConnectionPool, actor_id: str) -> int:
    count = await refresh_findings(pool)
    await record_audit(
        pool, actor_id=actor_id, action="refresh",
        entity_type="findings", entity_id="current",
        after_data={"current_findings": count},
    )
    return count


async def review_finding(
    pool: AsyncConnectionPool, finding_id: int, status: str,
    exception_reason: str | None, exception_until: date | datetime | None, actor_id: str,
) -> dict:
    before = await get_finding(pool, finding_id)
    if before is None:
        raise FindingNotFoundError(finding_id)
    if status == "excepted" and not exception_reason:
        raise ExceptionReasonRequiredError
    row = await update_finding(pool, finding_id, status, exception_reason, exception_until)
    await record_audit(
        pool, actor_id=actor_id, action="update",
        entity_type="finding", entity_id=str(finding_id),
        before_data={"status": before["status"], "exception_reason": before["exception_reason"]},
        after_data={"status": row["status"], "exception_reason": row["exception_reason"]},
    )
    return row
