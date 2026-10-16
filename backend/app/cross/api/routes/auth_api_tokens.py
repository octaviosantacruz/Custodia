from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, StringConstraints

from app.auth import require_session_actor
from app.cross.services.api_token_management import (
    TooManyActiveApiTokens,
    issue_personal_token,
    list_personal_tokens,
    revoke_personal_token,
)
from app.cross.services.audit_trail import (
    EVENT_API_TOKEN_ISSUED,
    EVENT_API_TOKEN_REVOKED,
    MECHANISM_API_TOKEN,
    record_security_event_for_request,
)


router = APIRouter(prefix="/api/auth/api-tokens")


class ApiTokenCreate(BaseModel):
    label: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    expires_in_minutes: int = Field(default=60, ge=5, le=480)


class ApiTokenIssued(BaseModel):
    token_id: UUID
    label: str
    created_at: datetime
    expires_at: datetime
    token: str
    token_type: Literal["Bearer"]
    scope: Literal["read"]


class ApiTokenListItem(BaseModel):
    token_id: UUID
    label: str
    auth_source: Literal["local", "oidc"]
    created_at: datetime
    expires_at: datetime
    revoked_at: datetime | None
    status: Literal["active", "expired", "revoked"]


class ApiTokenList(BaseModel):
    rows: list[ApiTokenListItem]


class ApiTokenRevoked(BaseModel):
    revoked: Literal[True]


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=ApiTokenIssued,
    summary="Crear token personal de API",
    description=(
        "Emite desde la sesión actual un token Bearer opaco y de sólo lectura. "
        "El valor se devuelve una sola vez, vence en un máximo de ocho horas y conserva los permisos actuales del actor."
    ),
)
async def issue_api_token(
    payload: ApiTokenCreate,
    request: Request,
    actor_id: str = Depends(require_session_actor),
):
    user = request.session.get("user") or {}
    auth_source = "oidc" if user.get("auth_source") == "oidc" else "local"
    session_version = user.get("session_version") if auth_source == "local" else None
    if auth_source == "local" and not isinstance(session_version, int):
        raise HTTPException(status_code=401, detail="La sesión local no puede emitir tokens")

    try:
        created, plaintext = await issue_personal_token(
            request.app.state.db,
            actor_id=actor_id,
            auth_source=auth_source,
            session_version=session_version,
            label=payload.label,
            expires_in_minutes=payload.expires_in_minutes,
        )
    except TooManyActiveApiTokens as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await record_security_event_for_request(
        request.app.state.db,
        request=request,
        event_type=EVENT_API_TOKEN_ISSUED,
        result="success",
        actor_id=actor_id,
        mechanism=MECHANISM_API_TOKEN,
        metadata={"token_id": str(created["token_id"]), "expires_in_minutes": payload.expires_in_minutes},
    )
    return {**created, "token": plaintext, "token_type": "Bearer", "scope": "read"}


@router.get(
    "",
    response_model=ApiTokenList,
    summary="Listar mis tokens de API",
    description="Lista sólo metadatos de los tokens del usuario actual; nunca devuelve hashes ni valores utilizables.",
)
async def my_api_tokens(request: Request, actor_id: str = Depends(require_session_actor)):
    return {"rows": await list_personal_tokens(request.app.state.db, actor_id)}


@router.delete(
    "/{token_id}",
    response_model=ApiTokenRevoked,
    summary="Revocar mi token de API",
    description="Revoca un token perteneciente al usuario de la sesión actual. No acepta autenticación mediante otro token.",
)
async def revoke_my_api_token(
    token_id: UUID,
    request: Request,
    actor_id: str = Depends(require_session_actor),
):
    revoked = await revoke_personal_token(request.app.state.db, actor_id, token_id)
    if not revoked:
        raise HTTPException(status_code=404, detail="Token no encontrado")
    await record_security_event_for_request(
        request.app.state.db,
        request=request,
        event_type=EVENT_API_TOKEN_REVOKED,
        result="success",
        actor_id=actor_id,
        mechanism=MECHANISM_API_TOKEN,
        metadata={"token_id": str(token_id)},
    )
    return {"revoked": True}
