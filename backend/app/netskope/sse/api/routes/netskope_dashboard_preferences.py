from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator, model_validator

from app.auth import require_any_permission_read, require_permission, require_permission_read, require_read_access
from app.cross.services.workspace_state import (
    list_actor_dashboard_templates,
    publish_dashboard_template,
)
from app.netskope.sse.services.netskope_state import (
    get_netskope_dashboard_preferences,
    save_netskope_dashboard_preferences,
)
from app.cross.api.routes.preferences_models import DashboardRoleTemplateRow, DashboardRoleTemplatesResponse
from app.netskope.sse.api.routes.preferences_models import NetskopeDashboardPreferencesResponse, NetskopeMetricContractResponse

from app.netskope.sse.metric_contracts import CHART_WIDGETS, DATA_WIDGETS, METRIC_CONTRACTS, widget_filter_keys
from app.netskope.sse.services.netskope_metric_registry import is_chart_widget, is_known_widget, metric_contracts
from app.netskope.sse.services.netskope_aa_charts import WIDGET_PREFIX, aa_chart_for_widget

# The static contracts; tenant-declared `aa_` charts are resolved at call time.
ALL_WIDGETS = DATA_WIDGETS | CHART_WIDGETS
# NSK-HB-001: the Netskope heartbeat flag swings with the time of the sync, so its
# widgets were retired. Saved views and role templates that still hold them are
# read without them instead of failing; writes keep rejecting unknown ids.
RETIRED_WIDGETS = frozenset({
    "devices_heartbeat_active", "devices_heartbeat_inactive", "devices_heartbeat_unknown", "heartbeat_status",
    "alerts_by_policy", "alerts_by_type", "alerts_by_action",
    # NSK-INV-002: manual device classification left the screens; its two widgets retire with it.
    "devices_stale_unclassified", "devices_stale_by_diagnosis",
})
DEFAULT_DATA_WIDGETS = ["users_recent_activity", "devices_total", "devices_stale_30d", "alerts_7d"]
DEFAULT_CHART_WIDGETS = ["devices_by_os", "devices_by_company", "devices_by_classification"]
DEFAULT_CHART_WIDGET_SIZE = "md"
MAX_WIDGETS_PER_KIND = 6
WIDGET_FILTER_KEYS = frozenset({"os", "company", "classification_status"})

router = APIRouter(
    prefix="/api/dashboard/netskope",
    tags=["Analítica"],
    dependencies=[Depends(require_any_permission_read("access:manage", "netskope:read"))],
)


def _has_category_style(widget_id: str) -> bool:
    """Only the plain category distributions can be drawn as a donut or as bars."""
    contract = METRIC_CONTRACTS.get(widget_id)
    if contract is None:
        return aa_chart_for_widget(widget_id) is not None
    return contract.kind == "chart" and contract.adapter.source == "inventory_sql"


class NetskopeWidgetInstance(BaseModel):
    id: str
    size: Literal["sm", "md", "lg"] = "sm"
    filters: dict[str, str] = Field(default_factory=dict)
    # How a category chart is drawn; absent means the widget's own default.
    style: Literal["donut", "bars"] | None = None

    @field_validator("id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if not is_known_widget(value):
            raise ValueError(f"Bloque Netskope desconocido: {value}")
        return value

    @field_validator("filters")
    @classmethod
    def validate_filters(cls, values: dict[str, str]) -> dict[str, str]:
        cleaned: dict[str, str] = {}
        for key, raw in values.items():
            if key not in WIDGET_FILTER_KEYS:
                raise ValueError(f"Filtro de widget Netskope desconocido: {key}")
            value = (raw or "").strip()
            if len(value) > 160:
                raise ValueError("Los valores de filtro admiten hasta 160 caracteres")
            if value:
                cleaned[key] = value
        return cleaned


    @model_validator(mode="after")
    def validate_metric_filters(self):
        unsupported = set(self.filters) - set(widget_filter_keys(self.id))
        if unsupported:
            raise ValueError("El filtro no aplica al contrato de este widget Netskope")
        if self.style is not None and not _has_category_style(self.id):
            raise ValueError("Este bloque Netskope no admite elegir dona o barras")
        return self


class NetskopeDashboardPreferenceUpdate(BaseModel):
    widgets: list[NetskopeWidgetInstance] | None = Field(default=None, max_length=12)
    data_widgets: list[str] | None = Field(default=None, max_length=MAX_WIDGETS_PER_KIND)
    chart_widgets: list[str] | None = Field(default=None, max_length=MAX_WIDGETS_PER_KIND)

    @field_validator("data_widgets")
    @classmethod
    def validate_data_widgets(cls, values: list[str] | None) -> list[str] | None:
        return _validate_widgets(values, DATA_WIDGETS.__contains__, "data_widgets")

    @field_validator("chart_widgets")
    @classmethod
    def validate_chart_widgets(cls, values: list[str] | None) -> list[str] | None:
        return _validate_widgets(values, is_chart_widget, "chart_widgets")

    @model_validator(mode="after")
    def resolve_widgets(self):
        """Accept the legacy id arrays for compatibility and normalize both
        shapes into the widget instances the response always returns."""
        if self.widgets is None:
            self.widgets = [
                NetskopeWidgetInstance(id=widget) for widget in (self.data_widgets or [])
            ] + [
                NetskopeWidgetInstance(id=widget, size=DEFAULT_CHART_WIDGET_SIZE)
                for widget in (self.chart_widgets or [])
            ]
        ids = [widget.id for widget in self.widgets]
        if len(ids) != len(set(ids)):
            raise ValueError("La vista Netskope no puede contener bloques duplicados")
        data_count = sum(1 for widget in ids if widget in DATA_WIDGETS)
        if data_count > MAX_WIDGETS_PER_KIND or len(ids) - data_count > MAX_WIDGETS_PER_KIND:
            raise ValueError("La vista Netskope admite hasta 6 datos y 6 gráficos")
        return self


def _validate_widgets(values: list[str] | None, allowed, field: str) -> list[str] | None:
    if values is None:
        return None
    if len(values) != len(set(values)):
        raise ValueError(f"{field} no puede contener bloques duplicados")
    unknown = {value for value in values if not allowed(value)}
    if unknown:
        raise ValueError(f"Bloque Netskope desconocido: {sorted(unknown)[0]}")
    return values


def _default_widgets() -> list[dict[str, object]]:
    return [
        {"id": widget, "size": "sm", "filters": {}} for widget in DEFAULT_DATA_WIDGETS
    ] + [
        {"id": widget, "size": DEFAULT_CHART_WIDGET_SIZE, "filters": {}} for widget in DEFAULT_CHART_WIDGETS
    ]


def _removed_aa_chart(widget_id: str) -> bool:
    """An `aa_` chart whose entry left the tenant map is dropped when a saved view is read."""
    return widget_id.startswith(WIDGET_PREFIX) and widget_id not in METRIC_CONTRACTS and aa_chart_for_widget(widget_id) is None


def without_retired_widgets(widgets: list[dict]) -> list[dict]:
    """Drop only the retired widget instances, keeping order, size and filters.

    A view that is empty only because everything in it was retired falls back to
    the defaults; one the user saved empty on purpose stays empty.
    """
    kept = [widget for widget in widgets if widget["id"] not in RETIRED_WIDGETS and not _removed_aa_chart(widget["id"])]
    return kept if kept or not widgets else _default_widgets()


def _saved_widget(item: dict) -> dict[str, object]:
    widget: dict[str, object] = {"id": item["id"], "size": item.get("size", "sm"), "filters": item.get("filters") or {}}
    if item.get("style") in ("donut", "bars"):
        widget["style"] = item["style"]
    return widget


def _normalize_widgets(saved: dict | None) -> list[dict[str, object]]:
    if not saved:
        return _default_widgets()
    if saved.get("widgets") is not None:
        return without_retired_widgets([
            _saved_widget(item) for item in saved["widgets"]
        ])
    return without_retired_widgets([
        {"id": widget, "size": "sm", "filters": {}} for widget in saved["data_widgets"]
    ] + [
        {"id": widget, "size": DEFAULT_CHART_WIDGET_SIZE, "filters": {}} for widget in saved["chart_widgets"]
    ])


def _response(saved: dict | None) -> dict:
    widgets = _normalize_widgets(saved)
    return {
        "widgets": widgets,
        "data_widgets": [widget["id"] for widget in widgets if widget["id"] in DATA_WIDGETS],
        "chart_widgets": [widget["id"] for widget in widgets if widget["id"] not in DATA_WIDGETS],
        "is_default": saved is None,
    }


@router.get("/contracts", response_model=list[NetskopeMetricContractResponse],
            dependencies=[Depends(require_permission_read("netskope:read"))],
            summary="Contratos de las métricas Netskope",
            description="Fuentes, unidades, períodos, filtros y capacidades; no ejecuta consultas AA ni confirma disponibilidad de datos.")
async def netskope_metric_contracts():
    return metric_contracts()


@router.get(
    "/preferences",
    response_model=NetskopeDashboardPreferencesResponse,
    response_model_exclude_none=True,
    summary="Obtener el panel personal de Netskope",
    description="Devuelve los bloques del tablero Netskope del actor; usa los valores por defecto si nunca lo guardó.",
)
async def netskope_dashboard_preferences(
    request: Request,
    actor_id: str = Depends(require_read_access),
):
    saved = await get_netskope_dashboard_preferences(request.app.state.db, actor_id)
    return _response(saved)


@router.put(
    "/preferences",
    response_model=NetskopeDashboardPreferencesResponse,
    response_model_exclude_none=True,
    summary="Guardar el panel personal de Netskope",
    description="Persiste los bloques y filtros del tablero Netskope del actor. Acepta el formato anterior por compatibilidad.",
)
async def netskope_dashboard_preferences_update(
    payload: NetskopeDashboardPreferenceUpdate,
    request: Request,
    actor_id: str = Depends(require_read_access),
):
    widgets = [widget.model_dump(exclude_none=True) for widget in (payload.widgets or [])]
    saved = await save_netskope_dashboard_preferences(
        request.app.state.db,
        actor_id,
        widgets,
        [widget["id"] for widget in widgets if widget["id"] in DATA_WIDGETS],
        [widget["id"] for widget in widgets if widget["id"] not in DATA_WIDGETS],
    )
    return _response(saved)


@router.post(
    "/preferences/preview", response_model=NetskopeDashboardPreferencesResponse, response_model_exclude_none=True,
    summary="Previsualizar una vista Netskope",
    description="Valida y normaliza los bloques enviados sin persistir la vista personal ni una plantilla.",
)
async def netskope_dashboard_preferences_preview(
    payload: NetskopeDashboardPreferenceUpdate,
    actor_id: str = Depends(require_read_access),
):
    del actor_id
    return _response({"widgets": [widget.model_dump(exclude_none=True) for widget in (payload.widgets or [])]})


@router.get(
    "/preferences/templates", response_model=DashboardRoleTemplatesResponse,
    summary="Listar vistas Netskope de equipo disponibles",
    description="Devuelve la versión vigente de las plantillas Netskope publicadas para los roles asignados al actor.",
)
async def netskope_dashboard_templates(request: Request, actor_id: str = Depends(require_read_access)):
    templates = await list_actor_dashboard_templates(request.app.state.db, actor_id, "netskope")
    return {"templates": [{**template, "widgets": without_retired_widgets(template["widgets"])} for template in templates]}


@router.put(
    "/preferences/templates/{role_code}", response_model=DashboardRoleTemplateRow,
    summary="Publicar una vista Netskope para un rol",
    description="Agrega una versión validada de la plantilla del rol sin modificar preferencias personales existentes.",
)
async def netskope_dashboard_template_publish(
    role_code: str,
    payload: NetskopeDashboardPreferenceUpdate,
    request: Request,
    actor_id: str = Depends(require_permission("access:roles_manage")),
):
    widgets = [widget.model_dump(exclude_none=True) for widget in (payload.widgets or [])]
    try:
        return await publish_dashboard_template(request.app.state.db, actor_id, role_code, "netskope", widgets)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
