"""Durable, privacy-preserving authentication/security telemetry."""

import hashlib
import hmac
import ipaddress
import logging
import re

from psycopg.types.json import Jsonb

from app.db import fetch_all
from app.cross.services.secret_values import secret_from_environment

LOGGER = logging.getLogger(__name__)
EVENT_LOGIN_SUCCESS = "login_success"
EVENT_LOGIN_FAILURE = "login_failure"
EVENT_LOGOUT = "logout"
EVENT_SELF_REGISTER_CREATED = "self_register_created"
EVENT_BOOTSTRAP_ADMIN_CREATED = "bootstrap_admin_created"
EVENT_TECHNICAL_TOKEN_REJECTED = "technical_token_rejected"
EVENT_RATE_LIMIT_BLOCKED = "rate_limit_blocked"
EVENT_OIDC_ROLE_SYNC = "oidc_role_sync"
EVENT_SESSION_REJECTED_STALE = "session_rejected_stale_version"
EVENT_API_TOKEN_ISSUED = "api_token_issued"
EVENT_API_TOKEN_REVOKED = "api_token_revoked"
EVENT_API_TOKEN_REJECTED = "api_token_rejected"
MECHANISM_LOCAL = "local"
MECHANISM_OIDC = "oidc"
MECHANISM_BOOTSTRAP = "bootstrap"
MECHANISM_TOKEN = "token"
MECHANISM_SYSTEM = "system"
MECHANISM_API_TOKEN = "api_token"
_REQUEST_ID = re.compile(r"[^A-Za-z0-9._:-]")


def _digest(value: str, kind: str) -> str:
    secret = secret_from_environment("SESSION_SECRET", "SESSION_SECRET_FILE").encode()
    normalized = value.strip().casefold()
    return hmac.new(secret, f"security-event:{kind}:".encode() + normalized.encode(), hashlib.sha256).hexdigest()


def _safe_actor_id(actor_id: str | None) -> str | None:
    normalized = actor_id.strip().casefold() if actor_id else None
    return _digest(normalized, "actor") if normalized and "@" in normalized else normalized


def _context(request, email: str | None = None) -> tuple[str, str | None, str | None]:
    host = getattr(getattr(request, "client", None), "host", "") or "unknown"
    try:
        host = str(ipaddress.ip_address(host))
    except ValueError:
        host = "unknown"
    headers = getattr(request, "headers", {}) or {}
    request_id = _REQUEST_ID.sub("", str(headers.get("X-Request-ID", "")))[:128] or None
    email_digest = _digest(email, "email") if email else None
    return _digest(host, "ip"), email_digest, request_id


def security_request_context(request, *, email: str | None = None) -> dict[str, str]:
    """Expose the normalized, non-PII request context for focused tests."""
    source_ip, email_digest, request_id = _context(request, email)
    context = {"source_ip": source_ip}
    if email_digest:
        context["email_digest"] = email_digest
    if request_id:
        context["request_id"] = request_id
    return context


async def record_security_event(
    pool,
    *,
    event_type: str,
    result: str,
    actor_id: str | None = None,
    source_ip: str | None = None,
    request_id: str | None = None,
    mechanism: str | None = None,
    metadata: dict | None = None,
    connection=None,
) -> None:
    query = """INSERT INTO public.access_security_events
        (event_type, actor_id, result, source_ip, request_id, mechanism, metadata)
        VALUES (%s, %s, %s, %s, %s, %s, %s)"""
    params = (event_type, _safe_actor_id(actor_id), result,
              source_ip, request_id, mechanism, Jsonb(metadata or {}))
    if connection is not None:
        await connection.execute(query, params)
        return
    async with pool.connection() as conn:
        await conn.execute(query, params)


async def record_security_event_for_request(
    pool, *, request, event_type: str, result: str, actor_id: str | None = None,
    mechanism: str | None = None, email: str | None = None,
    metadata: dict | None = None,
) -> None:
    """Best-effort writer: telemetry must not change the auth response."""
    source_ip, email_digest, request_id = _context(request, email)
    payload = dict(metadata or {})
    if email_digest:
        payload["email_digest"] = email_digest
    try:
        await record_security_event(pool, event_type=event_type, result=result,
                                   actor_id=actor_id, source_ip=source_ip,
                                   request_id=request_id, mechanism=mechanism,
                                   metadata=payload)
    except Exception:
        LOGGER.warning("No se pudo persistir el evento de seguridad %s", event_type)


async def list_security_events(pool, *, limit: int = 50, offset: int = 0,
                               event_type: str = "", result: str = "", q: str = "") -> dict:
    filters = ["1 = 1"]
    params: list[object] = []
    if event_type:
        filters.append("event.event_type = %s")
        params.append(event_type)
    if result:
        filters.append("event.result = %s")
        params.append(result)
    if q:
        filters.append("event.actor_id ILIKE '%%' || %s || '%%'")
        params.append(q)
    rows = await fetch_all(pool, f"""SELECT event.event_id, event.occurred_at,
        event.event_type, event.actor_id, coalesce(u.display_name, event.actor_id) AS actor_name,
        event.result, event.source_ip, event.request_id, event.mechanism, event.metadata,
        count(*) OVER ()::int AS total_count
        FROM public.access_security_events event LEFT JOIN public.access_users u ON u.actor_id = event.actor_id
        WHERE {' AND '.join(filters)} ORDER BY event.occurred_at DESC, event.event_id DESC LIMIT %s OFFSET %s""",
        tuple(params + [limit, offset]))
    total = rows[0]["total_count"] if rows else 0
    for row in rows:
        row.pop("total_count", None)
    return {"rows": rows, "total": total, "limit": limit, "offset": offset}
