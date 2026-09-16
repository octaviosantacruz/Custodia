import hmac
import os

from fastapi import APIRouter, HTTPException, Request

from ...auth import (
    LOCAL_AUTH_ENABLED,
    SELF_REGISTER_SETUP_ENABLED,
    hash_password_async,
)
from ...services.rate_limit_enforcement import (
    BOOTSTRAP_RATE_LIMIT_MAX_ATTEMPTS,
    BOOTSTRAP_RATE_LIMIT_WINDOW_SECONDS,
    clear_rate_limit,
    enforce_rate_limit,
)
from ...repositories.auth_queries import (
    FirstUserAlreadyExists, count_local_users, create_bootstrap_admin, create_first_local_admin,
)
from ...repositories.security_events import (
    EVENT_BOOTSTRAP_ADMIN_CREATED, EVENT_RATE_LIMIT_BLOCKED, EVENT_SELF_REGISTER_CREATED,
    EVENT_TECHNICAL_TOKEN_REJECTED,
    MECHANISM_BOOTSTRAP, record_security_event_for_request,
)
from .auth_models import BootstrapRequest

router = APIRouter(tags=["Autenticación"])


@router.post("/api/auth/register")
async def register_first_user(payload: BootstrapRequest, request: Request):
    # PENTEST-001: disabled unless explicitly opted in (ALLOW_SELF_REGISTER_SETUP=true).
    # Returns the same 404 as "local auth disabled" so the response doesn't
    # reveal whether the feature exists but is turned off.
    if not LOCAL_AUTH_ENABLED or not SELF_REGISTER_SETUP_ENABLED:
        raise HTTPException(status_code=404, detail="El registro local no está habilitado")
    key = f"ip:{request.client.host if request.client else 'unknown'}"
    try:
        await enforce_rate_limit(
            request.app.state.db, [key],
            max_attempts=BOOTSTRAP_RATE_LIMIT_MAX_ATTEMPTS, window_seconds=BOOTSTRAP_RATE_LIMIT_WINDOW_SECONDS,
        )
    except HTTPException as exc:
        if exc.status_code == 429:
            await record_security_event_for_request(request.app.state.db, request=request, event_type=EVENT_RATE_LIMIT_BLOCKED, result="failure", mechanism=MECHANISM_BOOTSTRAP, email=payload.email, metadata={"outcome": "blocked", "reason": "register"})
        raise
    password_hash = None
    try:
        password_hash = await hash_password_async(payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    actor_id = payload.email.strip().lower()
    if not actor_id:
        raise HTTPException(status_code=422, detail="El email es obligatorio")
    try:
        await create_first_local_admin(request.app.state.db, actor_id, payload.display_name.strip(), password_hash)
    except FirstUserAlreadyExists as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    request.session.clear()
    await clear_rate_limit(request.app.state.db, [key])
    await record_security_event_for_request(request.app.state.db, request=request, event_type=EVENT_SELF_REGISTER_CREATED, result="success", actor_id=actor_id, mechanism=MECHANISM_BOOTSTRAP, email=payload.email)
    return {"created": True, "authenticated": False, "actor_id": actor_id}


@router.post("/api/auth/bootstrap")
async def bootstrap(payload: BootstrapRequest, request: Request):
    key = f"ip:{request.client.host if request.client else 'unknown'}"
    try:
        await enforce_rate_limit(
            request.app.state.db, [key],
            max_attempts=BOOTSTRAP_RATE_LIMIT_MAX_ATTEMPTS, window_seconds=BOOTSTRAP_RATE_LIMIT_WINDOW_SECONDS,
        )
    except HTTPException as exc:
        if exc.status_code == 429:
            await record_security_event_for_request(request.app.state.db, request=request, event_type=EVENT_RATE_LIMIT_BLOCKED, result="failure", mechanism=MECHANISM_BOOTSTRAP, email=payload.email, metadata={"outcome": "blocked", "reason": "bootstrap"})
        raise
    token = request.headers.get("X-Bootstrap-Token", "")
    configured = os.environ.get("AUTH_BOOTSTRAP_TOKEN", "").strip()
    if not LOCAL_AUTH_ENABLED or not configured or not hmac.compare_digest(token, configured):
        await record_security_event_for_request(request.app.state.db, request=request, event_type=EVENT_TECHNICAL_TOKEN_REJECTED, result="failure", mechanism=MECHANISM_BOOTSTRAP, email=payload.email, metadata={"reason": "invalid_token"})
        raise HTTPException(status_code=403, detail="Bootstrap no autorizado")
    count = await count_local_users(request.app.state.db)
    if count > 0:
        await clear_rate_limit(request.app.state.db, [key])
        raise HTTPException(status_code=409, detail="El administrador inicial ya fue creado")
    try:
        password_hash = await hash_password_async(payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    actor_id = payload.email.strip().lower()
    await create_bootstrap_admin(request.app.state.db, actor_id, payload.display_name.strip(), password_hash)
    await clear_rate_limit(request.app.state.db, [key])
    await record_security_event_for_request(request.app.state.db, request=request, event_type=EVENT_BOOTSTRAP_ADMIN_CREATED, result="success", actor_id=actor_id, mechanism=MECHANISM_BOOTSTRAP, email=payload.email)
    return {"created": True, "actor_id": actor_id}
