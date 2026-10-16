import hmac

from fastapi import APIRouter, HTTPException, Request

from app.auth import (
    LOCAL_AUTH_ENABLED,
    SELF_REGISTER_SETUP_ENABLED,
)
from app.cross.services.rate_limit_enforcement import (
    BOOTSTRAP_RATE_LIMIT_MAX_ATTEMPTS,
    BOOTSTRAP_RATE_LIMIT_WINDOW_SECONDS,
    clear_rate_limit,
    enforce_rate_limit,
)
from app.cross.services.secret_values import secret_from_environment
from app.cross.services.initial_admin import (
    InitialAdminAlreadyExistsError,
    bootstrap_first_admin,
    register_first_admin,
)
from app.cross.services.audit_trail import (
    EVENT_BOOTSTRAP_ADMIN_CREATED,
    EVENT_RATE_LIMIT_BLOCKED,
    EVENT_SELF_REGISTER_CREATED,
    EVENT_TECHNICAL_TOKEN_REJECTED,
    MECHANISM_BOOTSTRAP,
    record_security_event_for_request,
)
from app.cross.api.routes.auth_models import BootstrapRequest

router = APIRouter()


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
    try:
        actor_id = await register_first_admin(request.app.state.db, payload.email, payload.display_name, payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except InitialAdminAlreadyExistsError as exc:
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
    configured = secret_from_environment("AUTH_BOOTSTRAP_TOKEN", "AUTH_BOOTSTRAP_TOKEN_FILE")
    if not LOCAL_AUTH_ENABLED or not configured or not hmac.compare_digest(token, configured):
        await record_security_event_for_request(request.app.state.db, request=request, event_type=EVENT_TECHNICAL_TOKEN_REJECTED, result="failure", mechanism=MECHANISM_BOOTSTRAP, email=payload.email, metadata={"reason": "invalid_token"})
        raise HTTPException(status_code=403, detail="Bootstrap no autorizado")
    try:
        actor_id = await bootstrap_first_admin(request.app.state.db, payload.email, payload.display_name, payload.password)
    except InitialAdminAlreadyExistsError as exc:
        await clear_rate_limit(request.app.state.db, [key])
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    await clear_rate_limit(request.app.state.db, [key])
    await record_security_event_for_request(request.app.state.db, request=request, event_type=EVENT_BOOTSTRAP_ADMIN_CREATED, result="success", actor_id=actor_id, mechanism=MECHANISM_BOOTSTRAP, email=payload.email)
    return {"created": True, "actor_id": actor_id}
