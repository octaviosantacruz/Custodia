from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.auth import require_permission, require_read_access
from app.cyberark.pam.services.dashboard_preference_store import (
    get_dashboard_preferences,
    save_dashboard_preferences,
)
from app.cross.services.workspace_state import (
    list_actor_dashboard_templates,
    publish_dashboard_template,
)
from app.cyberark.pam.schemas import DashboardPreferenceUpdate
from app.cyberark.pam.services.dashboard_preferences import DEFAULT_DASHBOARD_WIDGETS
from app.cyberark.pam.services.dashboard_widgets import evaluate_dashboard_widgets
from app.cyberark.pam.api.routes.preferences_models import DashboardPreferencesPreviewResponse, DashboardPreferencesResponse
from app.cross.api.routes.preferences_models import DashboardRoleTemplateRow, DashboardRoleTemplatesResponse

router = APIRouter(prefix="/api/dashboard", tags=["Analítica"])


def _stored_widgets(evaluated: list[dict]) -> list[dict]:
    stored = []
    for item in evaluated:
        widget = dict(item)
        if widget["kind"] == "goal" and widget.get("baseline_value") is None:
            widget["baseline_value"] = widget["value"]
        for transient in ("value", "buckets", "chart_data", "data_status", "total_accounts", "compliant_accounts", "measured_at", "covered_count", "total_count"):
            widget.pop(transient, None)
        stored.append(widget)
    return stored


RETIRED_CHART_GROUPINGS = frozenset({"inventory_trend"})


def _without_retired_widgets(widgets: list[dict]) -> list[dict]:
    """Drop the retired inventory-evolution chart from views saved before it was removed.

    A view that is empty only because of that falls back to the defaults; one saved empty on purpose stays empty.
    """
    kept = [widget for widget in widgets if (widget.get("chart") or {}).get("group_by") not in RETIRED_CHART_GROUPINGS]
    return kept if kept or not widgets else list(DEFAULT_DASHBOARD_WIDGETS)


def _normalise_widgets(widgets: list[dict]) -> list[dict]:
    """Apply current defaults to preferences saved by an older UI version."""
    compatible = []
    for widget in _without_retired_widgets(widgets):
        current = {**widget, "position": None if isinstance(widget.get("position"), int) and widget["position"] > 5 else widget.get("position")}
        kr1_shortcut = current.get("widget_id", "").startswith(("shortcut-kr1-safe-inventory-", "shortcut-kr1-safe-coverage-"))
        old_default = (
            (current.get("measure") == "safes" and current.get("title") == "KR1 · Safes inventariados")
            or (current.get("measure") == "kr1_safe_bu_coverage" and current.get("title") in {"KR1 · Cobertura de Safes", "Safes con unidad asignada"})
        )
        old_safe_account_shortcut = (
            current.get("widget_id", "").startswith("shortcut-safe-account-coverage-")
            and current.get("measure") == "safe_account_coverage"
            and current.get("title") == "Safes con cuentas"
        )
        if (kr1_shortcut and old_default) or old_safe_account_shortcut:
            current.update(title="KR1 · Safes con cuentas", measure="safe_account_coverage", value_format="percentage", filters={})
        if (current.get("widget_id", "").startswith("shortcut-kr1-safe-coverage-")
                and current.get("measure") == "safe_account_coverage"
                and current.get("title") in {"Safes con cuentas", "KR1 · Safes con cuentas (completitud)"}):
            current["title"] = "KR1 · Safes con cuentas"
        compatible.append(current)
    return [widget.model_dump() for widget in DashboardPreferenceUpdate(widgets=compatible).widgets]


@router.get(
    "/preferences",
    response_model=DashboardPreferencesResponse,
    response_model_exclude_unset=True,
    summary="Obtener el panel personal",
    description="Devuelve los bloques del tablero CyberArk del actor con sus valores evaluados; usa los valores por defecto si nunca lo guardó.",
)
async def dashboard_preferences(request: Request, actor_id: str = Depends(require_read_access), include_internal: bool = Query(True)):
    saved = await get_dashboard_preferences(request.app.state.db, actor_id)
    widgets = _normalise_widgets(saved["widgets"]) if saved else _normalise_widgets(list(DEFAULT_DASHBOARD_WIDGETS))
    return {
        "widgets": await evaluate_dashboard_widgets(request.app.state.db, widgets, include_internal),
        "is_default": saved is None,
    }


@router.put(
    "/preferences",
    response_model=DashboardPreferencesResponse,
    response_model_exclude_unset=True,
    summary="Guardar el panel personal",
    description="Persiste los bloques del tablero CyberArk del actor; los valores se recalculan al guardar.",
)
async def dashboard_preferences_update(
    payload: DashboardPreferenceUpdate,
    request: Request,
    actor_id: str = Depends(require_read_access),
    include_internal: bool = Query(True),
):
    widgets = [widget.model_dump() for widget in payload.widgets]
    evaluated = await evaluate_dashboard_widgets(request.app.state.db, widgets, include_internal)
    evaluated = _stored_widgets(evaluated)
    saved = await save_dashboard_preferences(request.app.state.db, actor_id, evaluated)
    return {"widgets": await evaluate_dashboard_widgets(request.app.state.db, saved["widgets"], include_internal), "is_default": False}


@router.post(
    "/preferences/preview",
    response_model=DashboardPreferencesPreviewResponse,
    response_model_exclude_unset=True,
    summary="Previsualizar bloques sin guardarlos",
    description="Evalúa los bloques enviados sin persistirlos, para que el editor muestre el resultado antes de guardar.",
)
async def dashboard_preferences_preview(
    payload: DashboardPreferenceUpdate,
    request: Request,
    actor_id: str = Depends(require_read_access),
    include_internal: bool = Query(True),
):
    widgets = [widget.model_dump() for widget in payload.widgets]
    return {"widgets": await evaluate_dashboard_widgets(request.app.state.db, widgets, include_internal)}


@router.get(
    "/preferences/templates", response_model=DashboardRoleTemplatesResponse,
    summary="Listar vistas de equipo disponibles",
    description="Devuelve la versión vigente de las plantillas CyberArk publicadas para los roles asignados al actor.",
)
async def dashboard_templates(request: Request, actor_id: str = Depends(require_read_access)):
    templates = await list_actor_dashboard_templates(request.app.state.db, actor_id, "cyberark")
    return {"templates": [{**template, "widgets": _without_retired_widgets(template["widgets"])} for template in templates]}


@router.put(
    "/preferences/templates/{role_code}", response_model=DashboardRoleTemplateRow,
    summary="Publicar una vista CyberArk para un rol",
    description="Valida la vista y agrega una versión de plantilla para el rol sin modificar preferencias personales.",
)
async def dashboard_template_publish(
    role_code: str,
    payload: DashboardPreferenceUpdate,
    request: Request,
    actor_id: str = Depends(require_permission("access:roles_manage")),
    include_internal: bool = Query(True),
):
    widgets = [widget.model_dump() for widget in payload.widgets]
    evaluated = await evaluate_dashboard_widgets(request.app.state.db, widgets, include_internal)
    try:
        return await publish_dashboard_template(request.app.state.db, actor_id, role_code, "cyberark", _stored_widgets(evaluated))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
