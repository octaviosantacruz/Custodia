"""Read/query facade for the routes of this tool (ARCH-LAYERS-002).

Routes (Controller) depend on ``services/``; this module is the single place
where they reach the repositories below. SQL and audit stay in the
repositories; add domain logic here, not in the route.
"""

from __future__ import annotations

import csv
import io
import json
from typing import Any

from app.cross.repositories.activity_events import (
    list_activity_events,
)
from app.cross.repositories.audit import (
    export_activity,
    list_activity,
    record_audit,
)
from app.cross.repositories.security_events import (
    EVENT_API_TOKEN_ISSUED,
    EVENT_API_TOKEN_REVOKED,
    EVENT_BOOTSTRAP_ADMIN_CREATED,
    EVENT_LOGIN_FAILURE,
    EVENT_LOGIN_SUCCESS,
    EVENT_LOGOUT,
    EVENT_RATE_LIMIT_BLOCKED,
    EVENT_SELF_REGISTER_CREATED,
    EVENT_TECHNICAL_TOKEN_REJECTED,
    MECHANISM_API_TOKEN,
    MECHANISM_BOOTSTRAP,
    MECHANISM_LOCAL,
    list_security_events,
    record_security_event_for_request,
)

__all__ = [
    "EVENT_API_TOKEN_ISSUED",
    "EVENT_API_TOKEN_REVOKED",
    "EVENT_BOOTSTRAP_ADMIN_CREATED",
    "EVENT_LOGIN_FAILURE",
    "EVENT_LOGIN_SUCCESS",
    "EVENT_LOGOUT",
    "EVENT_RATE_LIMIT_BLOCKED",
    "EVENT_SELF_REGISTER_CREATED",
    "EVENT_TECHNICAL_TOKEN_REJECTED",
    "MECHANISM_API_TOKEN",
    "MECHANISM_BOOTSTRAP",
    "MECHANISM_LOCAL",
    "export_activity_csv",
    "list_activity",
    "list_activity_events",
    "list_security_events",
    "record_audit",
    "record_security_event_for_request",
]


EXPORT_LIMIT = 10000
ACTIVITY_EXPORT_HEADERS = (
    "ID", "Fecha (UTC)", "Actor ID", "Actor", "Acción", "Entidad", "ID de entidad", "Nombre de entidad", "Antes", "Después",
)
# OWASP: a leading tab or carriage return also makes a spreadsheet read the cell as a formula.
_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _cell(value: Any) -> Any:
    if value is None:
        return ""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value
    text = str(value)
    return "'" + text if text.startswith(_FORMULA_PREFIXES) else text


def _json_cell(value: Any) -> str:
    return "" if value is None else _cell(json.dumps(value, ensure_ascii=False, default=str, sort_keys=True))


async def export_activity_csv(pool, actor_id: str, *, action: str = "", entity_type: str = "", q: str = "") -> str:
    """The audited export of the Actividad view: same filters, newest first, capped at EXPORT_LIMIT rows."""
    result = await export_activity(pool, limit=EXPORT_LIMIT, action=action, entity_type=entity_type, q=q)
    rows = result["rows"]
    await record_audit(
        pool, actor_id=actor_id, action="export", entity_type="activity_log", entity_id="filtered",
        after_data={
            "row_count": len(rows), "matching": result["total"], "truncated": result["total"] > len(rows),
            "filters": {key: value for key, value in (("action", action), ("entity_type", entity_type), ("q", q)) if value},
        },
    )
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(ACTIVITY_EXPORT_HEADERS)
    for row in rows:
        writer.writerow([
            row["audit_id"], row["created_at"].isoformat(), _cell(row["actor_id"]), _cell(row["actor_name"]),
            _cell(row["action"]), _cell(row["entity_type"]), _cell(row["entity_id"]), _cell(row["entity_name"]),
            _json_cell(row["before_data"]), _json_cell(row["after_data"]),
        ])
    return output.getvalue()
