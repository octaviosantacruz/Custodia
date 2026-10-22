from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.auth import get_actor_permissions, require_read_access
from app.cross.services.workspace_state import (
    MAX_RECENT,
    MAX_VISIBLE,
    get_workspace_preferences,
    save_workspace_preferences,
)
from app.cross.api.routes.preferences_models import WorkspacePreferencesResponse

ALLOWED_WORKSPACES = {
    # Keep this contract in sync with frontend/src/cross/lib/workspace-catalog.ts:
    # WorkspaceCatalogContractTests parses that catalog and fails when a new
    # workspace id is not mirrored here (a missing id rejects every preference
    # save with "Workspace desconocido"). Retain ipInventory for preferences
    # persisted before the workspace was renamed. netskopeAlerts is
    # deliberately absent: the retired Investigación view is dropped from
    # legacy preferences by _known(), and its replacement destination is
    # netskopeInventory (single table; users/devices remain filtered deep links).
    "general", "posture", "graph", "person", "safes", "roles", "platforms", "connectors", "pamCleanup",
    "identityUsers", "identityGroups", "identityRoles", "sia", "identity", "assets",
    "users", "activity", "help", "pamHealth", "siaConnectors",
    "siaResources", "siaDatabaseAccounts", "identityFederations", "ipInventory",
    "netskope", "netskopeOperations", "netskopeChains", "netskopeInventory", "netskopeUsers", "netskopeDevices",
    "netskopeDlp", "netskopeDemSites", "netskopeUci", "netskopePosture", "netskopeAdmins", "netskopeOfficeExperience",
}

# Workspace ids retired from the product. They are never accepted in a write
# and are filtered out of any preference read, so a stale stored value cannot
# resurrect a destination the UI no longer offers.
# identityGraph (Cadena Identity) was folded into Relaciones ("graph").
# accessAssets and siaTargetSets were removed from the SIA hub (2026-10-10);
# their sources keep syncing but no longer have a view.
# netskopeSteering was removed with its sync (2026-10-10): the POP catalog is
# the same for every Netskope tenant and the tenant has no tunnels.
# netskopePolicies became the Actividad de políticas tab of Postura (2026-10-10).
# personCoverage was retired on 2026-10-11; its old URL opens Personas.
RETIRED_WORKSPACES = {"netskopeAlerts", "aimApplications", "identityGraph", "accessAssets", "siaTargetSets", "netskopeSteering", "netskopePolicies", "personCoverage"}

router = APIRouter(prefix="/api/workspaces", tags=["Preferencias de workspace"])

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


def _known(values: list[str]) -> list[str]:
    """Drop workspace ids retired from the product from legacy preferences."""
    return [
        value for value in values
        if value in ALLOWED_WORKSPACES and value not in RETIRED_WORKSPACES
    ]


def _accessible(values: list[str], permissions: list[str]) -> list[str]:
    # `restricted` are the access:manage-first workspaces (kept in preferences
    # only for access:manage holders, even when a narrow read permission also
    # opens them); `netskope` is the netskope:read family. `dlp_alerts` is the
    # NSK-DLP-001 strict workspace: only netskope:dlp_read opens it, and
    # access:manage deliberately does not. `person` accepts any of three tool
    # reads, so it is not narrowed here -- the switcher filters preferences by
    # effective access before rendering.
    restricted = {"graph", "platforms", "connectors", "users", "activity"}
    netskope = {"netskope", "netskopePosture", "netskopeOperations", "netskopeInventory", "netskopeUsers", "netskopeDevices", "netskopeChains"}
    dlp_alerts = {"netskopeDlp"}
    # NSK-UBA-002 / NSK-EXP-OFFICE-001: strict like DLP; only netskope:uba_read opens the UCI and office views.
    uba = {"netskopeUci", "netskopeOfficeExperience"}
    # NSK-RBAC-001: strict as well; only netskope:admin_inventory_read opens the administrators view.
    admin_inventory = {"netskopeAdmins"}
    can_read_netskope = "access:manage" in permissions or "netskope:read" in permissions
    can_read_dlp_alerts = "netskope:dlp_read" in permissions
    can_read_uba = "netskope:uba_read" in permissions
    can_read_admin_inventory = "netskope:admin_inventory_read" in permissions
    return [
        value for value in values
        if (value not in restricted or "access:manage" in permissions)
        and (value not in netskope or can_read_netskope)
        and (value not in dlp_alerts or can_read_dlp_alerts)
        and (value not in uba or can_read_uba)
        and (value not in admin_inventory or can_read_admin_inventory)
    ]

def _inaccessible(values: list[str], permissions: list[str]) -> list[str]:
    accessible = set(_accessible(values, permissions))
    return [value for value in values if value not in accessible]


@router.get(
    "/preferences",
    response_model=WorkspacePreferencesResponse,
    summary="Obtener preferencias de workspace",
    description="Devuelve los workspaces visibles, ocultos y recientes del actor, filtrados por sus permisos efectivos.",
)
async def workspace_preferences(request: Request, actor_id: str = Depends(require_read_access)):
    saved = await get_workspace_preferences(request.app.state.db, actor_id)
    permissions = await get_actor_permissions(request.app.state.db, actor_id)
    return {
        **saved,
        "visible_workspaces": _accessible(_known(saved["visible_workspaces"]), permissions),
        "hidden_workspaces": _accessible(_known(saved["hidden_workspaces"]), permissions),
        "recent_workspaces": _accessible(_known(saved["recent_workspaces"]), permissions),
    }


@router.put(
    "/preferences",
    response_model=WorkspacePreferencesResponse,
    summary="Guardar preferencias de workspace",
    description="Actualiza los workspaces visibles, ocultos y recientes del actor. Un workspace no puede quedar visible y oculto a la vez.",
)
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
    saved_visible = _known(saved["visible_workspaces"])
    saved_hidden = _known(saved["hidden_workspaces"])
    saved_recent = _known(saved["recent_workspaces"])
    # UX-NAV-001: quick access has one total, spread freely across tools.
    visible = _validate(
        _inaccessible(saved_visible, permissions) + _accessible(requested_visible, permissions)
        if requested_visible is not None else saved_visible,
        "visible_workspaces",
    )
    hidden = _validate(
        _inaccessible(saved_hidden, permissions) + _accessible(requested_hidden, permissions)
        if requested_hidden is not None else saved_hidden,
        "hidden_workspaces",
    )
    recent = _validate(
        _inaccessible(saved_recent, permissions) + _accessible(requested_recent, permissions)
        if requested_recent is not None else saved_recent,
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
