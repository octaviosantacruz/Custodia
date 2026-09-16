from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ...auth import get_actor_permissions, require_read_access
from ...repositories.workspace_preferences import (
    MAX_RECENT,
    MAX_VISIBLE,
    MAX_VISIBLE_PER_DOMAIN,
    get_workspace_preferences,
    save_workspace_preferences,
)

ALLOWED_WORKSPACES = {
    # Keep this contract in sync with frontend/src/lib/workspaces.ts. Retain
    # ipInventory for preferences persisted before the workspace was renamed.
    "general", "posture", "graph", "safes", "roles", "platforms", "connectors",
    "identityUsers", "identityGroups", "identityRoles", "sia", "identity", "assets",
    "users", "activity", "pamHealth", "aimApplications", "accessAssets", "siaConnectors",
    "siaResources", "siaDatabaseAccounts", "identityFederations", "ipInventory",
}

router = APIRouter(prefix="/api/workspaces", tags=["Preferencias de workspace"])

QUICK_ACCESS_WORKSPACES_BY_DOMAIN = {
    "admin": {"users", "activity"},
    "pam": {"general", "posture", "graph", "safes", "platforms", "connectors", "pamHealth", "identity", "sia"},
}


class WorkspacePreferencesUpdate(BaseModel):
    visible_workspaces: list[str] | None = Field(default=None, max_length=MAX_VISIBLE)
    hidden_workspaces: list[str] | None = Field(default=None, max_length=len(ALLOWED_WORKSPACES))
    recent_workspaces: list[str] | None = Field(default=None, max_length=MAX_RECENT)


def _validate(values: list[str], field: str) -> list[str]:
    if len(values) != len(set(values)):
        raise HTTPException(status_code=422, detail=f"{field} no puede contener workspaces duplicados")
    unknown = set(values) - ALLOWED_WORKSPACES
    if unknown:
        raise HTTPException(status_code=422, detail=f"Workspace desconocido: {sorted(unknown)[0]}")
    return values


def _validate_visible_per_domain(values: list[str]) -> list[str]:
    for domain_workspaces in QUICK_ACCESS_WORKSPACES_BY_DOMAIN.values():
        if sum(value in domain_workspaces for value in values) > MAX_VISIBLE_PER_DOMAIN:
            raise HTTPException(
                status_code=422,
                detail=f"visible_workspaces admite hasta {MAX_VISIBLE_PER_DOMAIN} accesos por herramienta",
            )
    return values


def _accessible(values: list[str], permissions: list[str]) -> list[str]:
    restricted = {"graph", "platforms", "connectors", "users", "activity"}
    return [value for value in values if value not in restricted or "access:manage" in permissions]

def _inaccessible(values: list[str], permissions: list[str]) -> list[str]:
    accessible = set(_accessible(values, permissions))
    return [value for value in values if value not in accessible]


@router.get("/preferences")
async def workspace_preferences(request: Request, actor_id: str = Depends(require_read_access)):
    saved = await get_workspace_preferences(request.app.state.db, actor_id)
    permissions = await get_actor_permissions(request.app.state.db, actor_id)
    return {
        **saved,
        "visible_workspaces": _accessible(saved["visible_workspaces"], permissions),
        "hidden_workspaces": _accessible(saved["hidden_workspaces"], permissions),
        "recent_workspaces": _accessible(saved["recent_workspaces"], permissions),
    }


@router.put("/preferences")
async def workspace_preferences_update(
    payload: WorkspacePreferencesUpdate,
    request: Request,
    actor_id: str = Depends(require_read_access),
):
    requested_visible = (
        _validate(payload.visible_workspaces, "visible_workspaces")
        if payload.visible_workspaces is not None else None
    )
    requested_hidden = (
        _validate(payload.hidden_workspaces, "hidden_workspaces")
        if payload.hidden_workspaces is not None else None
    )
    requested_recent = (
        _validate(payload.recent_workspaces, "recent_workspaces")
        if payload.recent_workspaces is not None else None
    )
    if requested_visible is not None and requested_hidden is not None and set(requested_visible) & set(requested_hidden):
        raise HTTPException(status_code=422, detail="Un workspace no puede estar visible y oculto")
    saved = await get_workspace_preferences(request.app.state.db, actor_id)
    permissions = await get_actor_permissions(request.app.state.db, actor_id)
    visible = _validate_visible_per_domain(_validate(
        _inaccessible(saved["visible_workspaces"], permissions) + _accessible(requested_visible, permissions)
        if requested_visible is not None else saved["visible_workspaces"],
        "visible_workspaces",
    ))
    hidden = _validate(
        _inaccessible(saved["hidden_workspaces"], permissions) + _accessible(requested_hidden, permissions)
        if requested_hidden is not None else saved["hidden_workspaces"],
        "hidden_workspaces",
    )
    recent = _validate(
        _inaccessible(saved["recent_workspaces"], permissions) + _accessible(requested_recent, permissions)
        if requested_recent is not None else saved["recent_workspaces"],
        "recent_workspaces",
    )
    if set(visible) & set(hidden):
        raise HTTPException(status_code=422, detail="Un workspace no puede estar visible y oculto")
    updated = await save_workspace_preferences(
        request.app.state.db,
        actor_id,
        visible_workspaces=visible,
        hidden_workspaces=hidden,
        recent_workspaces=recent,
    )
    return {
        **updated,
        "visible_workspaces": _accessible(updated["visible_workspaces"], permissions),
        "hidden_workspaces": _accessible(updated["hidden_workspaces"], permissions),
        "recent_workspaces": _accessible(updated["recent_workspaces"], permissions),
    }
