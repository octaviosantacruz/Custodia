import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from ...auth import (
    AUTH_MODE,
    LOCAL_AUTH_ENABLED,
    SELF_REGISTER_SETUP_ENABLED,
    _session_version_is_stale,
    finish_oidc_login,
    get_actor_permissions,
    logout,
    logout_oidc,
    needs_rehash,
    rehash_password_async,
    require_read_access,
    require_write_access,
    session_actor,
    start_oidc_login,
    start_session,
    verify_password_async,
)
from ...services.rate_limit_enforcement import (
    LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
    LOGIN_RATE_LIMIT_WINDOW_SECONDS,
    clear_rate_limit,
    enforce_rate_limit,
)
from ...repositories.auth_queries import (
    count_local_users, find_local_user_for_login, get_local_account_status, get_role_assignment_names,
    update_password_hash_after_rehash,
)
from ...repositories.security_events import (
    EVENT_LOGIN_FAILURE, EVENT_LOGIN_SUCCESS, EVENT_LOGOUT, EVENT_RATE_LIMIT_BLOCKED,
    MECHANISM_LOCAL, record_security_event_for_request,
)
from ...repositories.user_admin import InvalidCurrentPassword, InvalidUserPassword, change_own_password, update_own_profile
from .auth_models import LocalLogin, PasswordChange, ProfileUpdate

router = APIRouter(tags=["Autenticación"])
LOGGER = logging.getLogger(__name__)


@router.get("/api/auth/me")
async def auth_me(request: Request, actor_id: str = Depends(require_write_access)):
    permissions = await get_actor_permissions(request.app.state.db, actor_id)
    return {"actor_id": actor_id, "permissions": permissions}


@router.get("/api/auth/setup-status")
async def auth_setup_status(request: Request):
    # PENTEST-001: never report the window as available when self-register
    # is turned off, even if access_users happens to be empty -- the only
    # way to create the first admin in that configuration is
    # /api/auth/bootstrap with AUTH_BOOTSTRAP_TOKEN.
    if not SELF_REGISTER_SETUP_ENABLED:
        return {"available": False}
    count = await count_local_users(request.app.state.db)
    return {"available": LOCAL_AUTH_ENABLED and count == 0}


@router.get("/api/auth/login", name="auth_login")
async def auth_login(request: Request):
    if LOCAL_AUTH_ENABLED:
        return {"mode": "local"}
    return await start_oidc_login(request)


@router.get("/api/auth/oidc/login", name="auth_oidc_login")
async def oidc_login(request: Request, email: str | None = Query(default=None, max_length=320)):
    if AUTH_MODE not in {"oidc", "hybrid"}:
        raise HTTPException(status_code=404, detail="OIDC no está habilitado")
    return await start_oidc_login(request, login_hint=email)


@router.post("/api/auth/login")
async def local_login(payload: LocalLogin, request: Request):
    if not LOCAL_AUTH_ENABLED:
        raise HTTPException(status_code=404, detail="El login local no está habilitado")
    ip_key = f"ip:{request.client.host if request.client else 'unknown'}"
    email_key = f"email:{payload.email.strip().casefold()}"
    try:
        await enforce_rate_limit(
            request.app.state.db, [ip_key, email_key],
            max_attempts=LOGIN_RATE_LIMIT_MAX_ATTEMPTS, window_seconds=LOGIN_RATE_LIMIT_WINDOW_SECONDS,
        )
    except HTTPException as exc:
        if exc.status_code == 429:
            await record_security_event_for_request(request.app.state.db, request=request, event_type=EVENT_RATE_LIMIT_BLOCKED, result="failure", mechanism=MECHANISM_LOCAL, email=payload.email, metadata={"outcome": "blocked", "reason": "login"})
        raise
    user = await find_local_user_for_login(request.app.state.db, payload.email.strip())
    if not user or not await verify_password_async(payload.password, user["password_hash"]):
        await record_security_event_for_request(request.app.state.db, request=request, event_type=EVENT_LOGIN_FAILURE, result="failure", mechanism=MECHANISM_LOCAL, email=payload.email, metadata={"reason": "invalid_credentials"})
        raise HTTPException(status_code=401, detail="Email o contraseña inválidos")
    await clear_rate_limit(request.app.state.db, [ip_key, email_key])
    await record_security_event_for_request(request.app.state.db, request=request, event_type=EVENT_LOGIN_SUCCESS, result="success", actor_id=user["actor_id"], mechanism=MECHANISM_LOCAL, email=user.get("email"))
    # PENTEST-009: transparently upgrade a legacy scrypt hash (or refresh
    # stale Argon2id parameters) now that the plaintext just proved it
    # matches -- best-effort only. A failure here must never turn an
    # already-successful, already-verified login into an error response;
    # the account simply keeps its current hash and gets another chance
    # on its next login.
    if needs_rehash(user["password_hash"]):
        try:
            new_hash = await rehash_password_async(payload.password)
            await update_password_hash_after_rehash(request.app.state.db, user["actor_id"], new_hash)
        except Exception:
            LOGGER.warning("No se pudo migrar el hash de contraseña de %s a Argon2id", user["actor_id"], exc_info=True)
    start_session(request, {"actor_id": user["actor_id"], "name": user["display_name"], "email": user["email"], "roles": user["roles"] or [], "role_names": user.get("role_names") or [], "must_change_password": bool(user["must_change_password"]), "session_version": user["session_version"], "auth_source": "local"})
    return {"authenticated": True, "user": request.session["user"]}


@router.post("/api/auth/password")
async def change_password(payload: PasswordChange, request: Request, actor_id: str = Depends(require_read_access)):
    if not LOCAL_AUTH_ENABLED:
        raise HTTPException(status_code=404, detail="El cambio de contraseña local no está habilitado")
    try:
        new_session_version = await change_own_password(request.app.state.db, actor_id, payload.current_password, payload.new_password)
    except InvalidCurrentPassword as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except InvalidUserPassword as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    # PENTEST-004: password_change bumps session_version so any *other*
    # session (e.g. a stolen cookie) fails its next version check, but this
    # session -- the one legitimately making the change -- must be stamped
    # with the new version immediately or it would invalidate itself.
    request.session["user"] = {**request.session.get("user", {}), "must_change_password": False, "session_version": new_session_version}
    return {"updated": True}


@router.patch("/api/auth/me")
async def update_profile(payload: ProfileUpdate, request: Request, actor_id: str = Depends(require_read_access)):
    if not LOCAL_AUTH_ENABLED:
        raise HTTPException(status_code=404, detail="La edición de perfil local no está habilitada")
    try:
        profile = await update_own_profile(request.app.state.db, actor_id, payload.display_name)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if profile is None:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    request.session["user"] = {**request.session.get("user", {}), "name": profile["display_name"], "email": profile["email"]}
    return {"updated": True, "user": {"actor_id": profile["actor_id"], "name": profile["display_name"], "email": profile["email"]}}



@router.get("/api/auth/callback", name="auth_callback")
async def auth_callback(request: Request):
    return await finish_oidc_login(request)


@router.post("/api/auth/logout", name="auth_logout")
async def auth_logout(request: Request):
    actor_id = (request.session.get("user") or {}).get("actor_id", "anonymous")
    result = logout_oidc(request) if AUTH_MODE == "oidc" else logout(request)
    await record_security_event_for_request(request.app.state.db, request=request, event_type=EVENT_LOGOUT, result="success", actor_id=actor_id, mechanism=AUTH_MODE)
    return result


@router.get("/api/auth/status")
async def auth_status(request: Request):
    actor_id = session_actor(request)
    if actor_id and await _session_version_is_stale(request, actor_id):
        request.session.clear()
        actor_id = None
    user = request.session.get("user") if actor_id else None
    # PENTEST-001: same rule as /api/auth/setup-status -- never advertise
    # the self-register window when it's turned off.
    available = SELF_REGISTER_SETUP_ENABLED and LOCAL_AUTH_ENABLED and await count_local_users(request.app.state.db) == 0
    if actor_id and LOCAL_AUTH_ENABLED:
        account = await get_local_account_status(request.app.state.db, actor_id)
        if account:
            user = {**(user or {}), "roles": account["roles"] or [], "role_names": account.get("role_names") or [], "must_change_password": bool(account["must_change_password"])}
            request.session["user"] = user
    if actor_id and user and (not LOCAL_AUTH_ENABLED or "roles" not in user or "role_names" not in user):
        role_assignments = await get_role_assignment_names(request.app.state.db, actor_id)
        user = {**user, "roles": role_assignments["roles"], "role_names": role_assignments["role_names"]}
    permissions = await get_actor_permissions(request.app.state.db, actor_id) if actor_id else []
    return {
        "mode": AUTH_MODE if AUTH_MODE in {"local", "oidc", "hybrid"} else "local",
        "authenticated": bool(user),
        "user": user,
        "permissions": permissions,
        "setup_available": available,
    }
