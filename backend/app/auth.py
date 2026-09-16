import hmac
import os
import time
from collections.abc import Awaitable, Callable
from typing import Any

from authlib.integrations.starlette_client import OAuth
from fastapi import Header, HTTPException, Request
from starlette.responses import JSONResponse, RedirectResponse

from .repositories.auth_queries import get_actor_permissions, get_session_version, sync_oidc_role_assignments
from .repositories.security_events import (
    EVENT_OIDC_ROLE_SYNC, EVENT_SESSION_REJECTED_STALE, EVENT_TECHNICAL_TOKEN_REJECTED,
    MECHANISM_OIDC, MECHANISM_TOKEN, record_security_event_for_request,
)
from .services.oidc_mapping import role_map_from_environment, roles_from_claims
from .services.password_hashing import hash_password, hash_password_async, needs_rehash, rehash_password_async, validate_password, verify_password, verify_password_async

oauth = OAuth()
AUTH_MODE = os.environ.get("AUTH_MODE", "local").strip().lower()
LOCAL_AUTH_ENABLED = AUTH_MODE in {"local", "hybrid"}
OIDC_ENABLED = AUTH_MODE in {"oidc", "hybrid"}
# PENTEST-001: off by default. When on, POST /api/auth/register lets whoever
# reaches the login page first create the first local admin with no token,
# as long as access_users is still empty (fresh install, incomplete
# restore, or a reset database). Off by default closes that window in any
# environment that doesn't explicitly opt in (e.g. a demo/dev box); the
# unattended path stays /api/auth/bootstrap, which always requires
# AUTH_BOOTSTRAP_TOKEN regardless of this flag.
SELF_REGISTER_SETUP_ENABLED = os.environ.get("ALLOW_SELF_REGISTER_SETUP", "false").strip().lower() == "true"
OIDC_ISSUER_URL = os.environ.get("OIDC_ISSUER_URL", "").strip()
OIDC_CLIENT_ID = os.environ.get("OIDC_CLIENT_ID", "").strip()
OIDC_CLIENT_SECRET = os.environ.get("OIDC_CLIENT_SECRET", "").strip()
OIDC_CONFIGURED = bool(OIDC_ISSUER_URL and OIDC_CLIENT_ID and OIDC_CLIENT_SECRET)

if OIDC_ENABLED and OIDC_CONFIGURED:
    oauth.register(name="idp", server_metadata_url=OIDC_ISSUER_URL.rstrip("/") + "/.well-known/openid-configuration", client_id=OIDC_CLIENT_ID, client_secret=OIDC_CLIENT_SECRET, client_kwargs={"scope": os.environ.get("OIDC_SCOPES", "openid profile email")})


SESSION_IDLE_TIMEOUT_DEFAULT = 15 * 60
SESSION_STARTED_AT = "_session_started_at"
SESSION_LAST_ACTIVITY_AT = "_session_last_activity_at"

# PENTEST-002: must_change_password was only enforced by the frontend
# hiding the rest of the UI. A user (including a freshly created admin)
# could ignore that screen and call the API directly with the temporary
# password. Every session-based request now gets blocked here unless the
# route is one of the three the password-change screen itself needs.
MUST_CHANGE_PASSWORD_ALLOWLIST = {
    ("GET", "/api/auth/status"),
    ("POST", "/api/auth/password"),
    ("POST", "/api/auth/logout"),
}


def _blocked_by_pending_password_change(request: Request) -> bool:
    session = getattr(request, "session", {})
    user = session.get("user") if isinstance(session, dict) else None
    if not isinstance(user, dict) or not user.get("must_change_password"):
        return False
    return (request.method, request.url.path) not in MUST_CHANGE_PASSWORD_ALLOWLIST


async def _session_version_is_stale(request: Request, actor_id: str) -> bool:
    """PENTEST-004: True if this session's cached session_version no longer
    matches the account's current value in the database -- meaning the
    password was changed/reset, the account was deactivated, or the row no
    longer exists, since this cookie was issued. OIDC sessions are identified
    explicitly because DS Hub does not manage their credentials. A session
    without either that marker or a version is an old/ambiguous local cookie
    and is invalidated instead of bypassing revocation."""
    session = getattr(request, "session", {})
    user = session.get("user") if isinstance(session, dict) else None
    if isinstance(user, dict) and user.get("auth_source") == "oidc":
        return False
    if not isinstance(user, dict) or "session_version" not in user:
        return True
    current_version = await get_session_version(request.app.state.db, actor_id)
    return current_version is None or current_version != user["session_version"]


def _session_timeout(request: Request, name: str, default: int) -> int:
    return int(getattr(request.app.state, name, default))


def start_session(request: Request, user: dict[str, Any]) -> None:
    """Create a fresh session with timestamps used for idle expiry."""
    now = time.time()
    request.session.clear()
    request.session.update({
        "user": user,
        SESSION_STARTED_AT: now,
        SESSION_LAST_ACTIVITY_AT: now,
    })


def _local_actor(request: Request, x_access_token: str | None) -> str:
    configured_token = os.environ.get("APP_WRITE_TOKEN", "").strip()
    if not configured_token:
        raise HTTPException(status_code=503, detail="Las escrituras están deshabilitadas: falta configurar un usuario o APP_WRITE_TOKEN")
    if not x_access_token or not hmac.compare_digest(x_access_token, configured_token):
        raise HTTPException(status_code=401, detail="Token de escritura inválido")
    return os.environ.get("APP_ACTOR_ID", "local-admin").strip() or "local-admin"


def session_actor(request: Request) -> str | None:
    session = getattr(request, "session", {})
    user = session.get("user") if isinstance(session, dict) else None
    if not isinstance(user, dict) or not user.get("actor_id"):
        return None

    now = time.time()
    started_at = session.get(SESSION_STARTED_AT)
    last_activity_at = session.get(SESSION_LAST_ACTIVITY_AT)
    try:
        started_at = float(started_at)
        last_activity_at = float(last_activity_at)
    except (TypeError, ValueError):
        # Invalidate sessions created before idle-expiry metadata existed.
        request.session.clear()
        return None

    max_age = _session_timeout(request, "session_max_age_seconds", 8 * 60 * 60)
    idle_timeout = _session_timeout(request, "session_idle_timeout_seconds", SESSION_IDLE_TIMEOUT_DEFAULT)
    if now - started_at >= max_age or now - last_activity_at >= idle_timeout:
        request.session.clear()
        return None

    # Protected requests count as activity and refresh the signed cookie.
    request.session[SESSION_LAST_ACTIVITY_AT] = now
    return str(user["actor_id"])


async def _require_session_actor(request: Request) -> str:
    """Session-only actor resolution: resolves and validates the session
    (idle/absolute timeout, PENTEST-004 session_version, PENTEST-002
    pending password change) but never falls back to X-Access-Token.
    Shared by require_read_access and the require_*_read permission
    dependencies below -- none of them are meant to accept the technical
    token, which is scoped to write automation only (PENTEST-005)."""
    actor_id = session_actor(request)
    if not actor_id:
        raise HTTPException(status_code=401, detail="Sesión requerida")
    if await _session_version_is_stale(request, actor_id):
        await record_security_event_for_request(request.app.state.db, request=request, event_type=EVENT_SESSION_REJECTED_STALE, result="failure", actor_id=actor_id, mechanism=MECHANISM_TOKEN, metadata={"reason": "stale_session_version"})
        request.session.clear()
        raise HTTPException(status_code=401, detail="Sesión requerida")
    if _blocked_by_pending_password_change(request):
        raise HTTPException(status_code=403, detail="Debés cambiar tu contraseña temporal antes de continuar")
    return actor_id


async def require_read_access(request: Request) -> str:
    actor_id = await _require_session_actor(request)
    if "inventory:read" not in await get_actor_permissions(request.app.state.db, actor_id):
        raise HTTPException(status_code=403, detail="El actor no tiene permiso para consultar el inventario")
    request.state.actor_id = actor_id
    return actor_id


async def require_write_access(request: Request, x_access_token: str | None = Header(default=None)) -> str:
    session_id = session_actor(request)
    if session_id and await _session_version_is_stale(request, session_id):
        request.session.clear()
        raise HTTPException(status_code=401, detail="Sesión requerida")
    if session_id:
        actor_id = session_id
    else:
        try:
            actor_id = _local_actor(request, x_access_token)
        except HTTPException as exc:
            app = getattr(request, "app", None)
            if exc.status_code in {401, 503} and app is not None:
                await record_security_event_for_request(app.state.db, request=request, event_type=EVENT_TECHNICAL_TOKEN_REJECTED, result="failure", mechanism=MECHANISM_TOKEN, metadata={"reason": "invalid_or_unconfigured"})
            raise
    if session_id and _blocked_by_pending_password_change(request):
        raise HTTPException(status_code=403, detail="Debés cambiar tu contraseña temporal antes de continuar")
    request.state.actor_id = actor_id
    return actor_id


def require_permission(permission_code: str) -> Callable[..., Awaitable[str]]:
    async def dependency(request: Request, x_access_token: str | None = Header(default=None)) -> str:
        actor_id = await require_write_access(request, x_access_token)
        if permission_code not in await get_actor_permissions(request.app.state.db, actor_id):
            raise HTTPException(status_code=403, detail=f"El actor no tiene el permiso requerido: {permission_code}")
        return actor_id
    return dependency


def require_permission_read(permission_code: str) -> Callable[..., Awaitable[str]]:
    """Like require_permission, but for GET/read endpoints.

    PENTEST-005: X-Access-Token is documented (and meant) as an automation
    credential for write operations only; it must never authorize reads,
    including administrative ones (e.g. listing DS Hub users). Built on
    _require_session_actor, which never has an X-Access-Token branch, so a
    technical token here 401s exactly like it would with no credential at
    all. Unlike require_read_access, this does not also require the
    unrelated baseline inventory:read permission -- it mirrors
    require_permission's contract (only the requested permission_code),
    just without the token fallback.
    """
    async def dependency(request: Request) -> str:
        actor_id = await _require_session_actor(request)
        if permission_code not in await get_actor_permissions(request.app.state.db, actor_id):
            raise HTTPException(status_code=403, detail=f"El actor no tiene el permiso requerido: {permission_code}")
        request.state.actor_id = actor_id
        return actor_id
    return dependency


def require_any_permission_read(*permission_codes: str) -> Callable[..., Awaitable[str]]:
    """Read-only counterpart of require_any_permission (see PENTEST-005 note
    on require_permission_read): session only, never X-Access-Token, and no
    implicit inventory:read baseline."""
    if not permission_codes:
        raise ValueError("require_any_permission_read necesita al menos un permission_code")

    async def dependency(request: Request) -> str:
        actor_id = await _require_session_actor(request)
        granted = await get_actor_permissions(request.app.state.db, actor_id)
        if not any(code in granted for code in permission_codes):
            raise HTTPException(status_code=403, detail=f"El actor no tiene ninguno de los permisos requeridos: {', '.join(permission_codes)}")
        request.state.actor_id = actor_id
        return actor_id
    return dependency


def require_any_permission(*permission_codes: str) -> Callable[..., Awaitable[str]]:
    """Allow the request if the actor holds ANY of the given permission codes.

    Used to widen a route that used to require a single broad permission
    (typically access:manage) to also accept a narrower, purpose-built one,
    without weakening the broad permission's existing reach: an actor who
    already holds access:manage keeps working unchanged, and an actor who
    only holds the narrow permission now gets in too.
    """
    if not permission_codes:
        raise ValueError("require_any_permission necesita al menos un permission_code")

    async def dependency(request: Request, x_access_token: str | None = Header(default=None)) -> str:
        actor_id = await require_write_access(request, x_access_token)
        granted = await get_actor_permissions(request.app.state.db, actor_id)
        if not any(code in granted for code in permission_codes):
            raise HTTPException(status_code=403, detail=f"El actor no tiene ninguno de los permisos requeridos: {', '.join(permission_codes)}")
        return actor_id
    return dependency


oidc_role_map = role_map_from_environment
oidc_roles = roles_from_claims

async def start_oidc_login(request: Request, login_hint: str | None = None):
    if not OIDC_ENABLED:
        raise HTTPException(status_code=404, detail="OIDC no está habilitado")
    if not OIDC_CONFIGURED:
        raise HTTPException(status_code=503, detail="OIDC está habilitado, pero todavía falta completar la configuración de IAM")
    redirect_uri = os.environ.get("OIDC_REDIRECT_URI") or str(request.url_for("auth_callback"))
    return await oauth.idp.authorize_redirect(request, redirect_uri, **({"login_hint": login_hint.strip()} if login_hint and login_hint.strip() else {}))


async def finish_oidc_login(request: Request):
    if not OIDC_ENABLED:
        raise HTTPException(status_code=404, detail="OIDC no está habilitado")
    if not OIDC_CONFIGURED:
        raise HTTPException(status_code=503, detail="OIDC está habilitado, pero todavía falta completar la configuración de IAM")
    token = await oauth.idp.authorize_access_token(request)
    user = token.get("userinfo") or await oauth.idp.userinfo(token=token)
    actor_id = str(user.get("sub") or user.get("email") or "")
    if not actor_id:
        raise HTTPException(status_code=400, detail="El proveedor OIDC no devolvió una identidad")
    start_session(request, {"actor_id": actor_id, "name": user.get("name"), "email": user.get("email"), "auth_source": "oidc"})
    roles = oidc_roles(dict(user))
    await sync_oidc_role_assignments(request.app.state.db, actor_id, roles)
    await record_security_event_for_request(request.app.state.db, request=request, event_type=EVENT_OIDC_ROLE_SYNC, result="success", actor_id=actor_id, mechanism=MECHANISM_OIDC, email=user.get("email"), metadata={"roles_count": len(roles)})
    return RedirectResponse(url=os.environ.get("WEB_ORIGIN", "/"))


def logout(request: Request):
    request.session.clear()
    return JSONResponse({"logged_out": True})


def logout_oidc(request: Request):
    if not OIDC_ENABLED:
        raise HTTPException(status_code=404, detail="OIDC no está habilitado")
    return logout(request)
