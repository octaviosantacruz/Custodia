from fastapi import APIRouter, Depends, Query, Request

from ...auth import require_read_access
from ...repositories.dashboard_preferences import get_dashboard_preferences, save_dashboard_preferences
from ...schemas import DashboardPreferenceUpdate
from ...services.dashboard_preferences import DEFAULT_DASHBOARD_WIDGETS
from ...services.dashboard_widgets import evaluate_dashboard_widgets

router = APIRouter(prefix="/api/dashboard", tags=["Analítica"])


def _normalise_widgets(widgets: list[dict]) -> list[dict]:
    """Apply current defaults to preferences saved by an older UI version."""
    compatible = [
        {**widget, "position": None if isinstance(widget.get("position"), int) and widget["position"] > 5 else widget.get("position")}
        for widget in widgets
    ]
    return [widget.model_dump() for widget in DashboardPreferenceUpdate(widgets=compatible).widgets]


@router.get("/preferences", summary="Obtener el panel personal")
async def dashboard_preferences(request: Request, actor_id: str = Depends(require_read_access), include_internal: bool = Query(True)):
    saved = await get_dashboard_preferences(request.app.state.db, actor_id)
    widgets = _normalise_widgets(saved["widgets"]) if saved else _normalise_widgets(list(DEFAULT_DASHBOARD_WIDGETS))
    return {
        "widgets": await evaluate_dashboard_widgets(request.app.state.db, widgets, include_internal),
        "is_default": saved is None,
    }


@router.put("/preferences", summary="Guardar el panel personal")
async def dashboard_preferences_update(
    payload: DashboardPreferenceUpdate,
    request: Request,
    actor_id: str = Depends(require_read_access),
    include_internal: bool = Query(True),
):
    widgets = [widget.model_dump() for widget in payload.widgets]
    evaluated = await evaluate_dashboard_widgets(request.app.state.db, widgets, include_internal)
    for widget in evaluated:
        if widget["kind"] == "goal" and widget.get("baseline_value") is None:
            widget["baseline_value"] = widget["value"]
        widget.pop("value", None)
        widget.pop("buckets", None)
        widget.pop("chart_data", None)
        widget.pop("chart_data", None)
    saved = await save_dashboard_preferences(request.app.state.db, actor_id, evaluated)
    return {"widgets": await evaluate_dashboard_widgets(request.app.state.db, saved["widgets"], include_internal), "is_default": False}


@router.post("/preferences/preview", summary="Previsualizar bloques sin guardarlos")
async def dashboard_preferences_preview(
    payload: DashboardPreferenceUpdate,
    request: Request,
    actor_id: str = Depends(require_read_access),
    include_internal: bool = Query(True),
):
    widgets = [widget.model_dump() for widget in payload.widgets]
    return {"widgets": await evaluate_dashboard_widgets(request.app.state.db, widgets, include_internal)}
