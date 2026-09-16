import re
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from .services.dashboard_widgets import CHART_DIMENSION_NAMES as DASHBOARD_CHART_DIMENSIONS

EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def validate_email_format(value: str) -> str:
    """Shared email format check for user-facing account emails (login accounts)."""
    normalized = value.strip()
    if not EMAIL_PATTERN.match(normalized):
        raise ValueError("Ingresá un email válido")
    return normalized


class BusinessUnitCreate(BaseModel):
    unit_code: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    unit_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]


class ResponsibleCreate(BaseModel):
    display_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
    email: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=320)]


class BusinessUnitUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    unit_code: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    unit_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
    is_active: bool = True


class ResponsibleUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
    email: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=320)]
    is_active: bool = True


_ACTION_CANONICAL = {
    "migrar a sia": "Migrar a SIA",
    "migrar sia": "Migrar a SIA",
    "consultar": "Consultar",
    "revisar": "Revisar",
    "dar de baja": "Dar de baja",
    "revisar / dar de baja": "Revisar",
    "revisar/dar de baja": "Revisar",
    "rotar credencial": "Rotar credencial",
}


def normalize_next_action(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = " ".join(value.strip().split())
    if not normalized:
        return None
    return _ACTION_CANONICAL.get(normalized.casefold(), normalized)


class SafeAssignmentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    business_unit_id: int | None = Field(default=None, ge=1)
    responsible_id: int | None = Field(default=None, ge=1)


class SafeBulkAssignment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    safe_numbers: list[int] = Field(min_length=1, max_length=500)
    business_unit_id: int | None = Field(default=None, ge=1)
    responsible_id: int | None = Field(default=None, ge=1)
    workflow_status: str | None = Field(default=None, pattern="^(pending|in_progress|blocked|resolved|retired)$")

    @field_validator("safe_numbers")
    @classmethod
    def _positive_unique(cls, value: list[int]) -> list[int]:
        seen: list[int] = []
        for number in value:
            if number < 1:
                raise ValueError("safe_numbers debe contener enteros positivos")
            if number not in seen:
                seen.append(number)
        return seen

    @model_validator(mode="after")
    def _requires_an_actionable_field(self) -> "SafeBulkAssignment":
        assigns_owner = "business_unit_id" in self.model_fields_set or "responsible_id" in self.model_fields_set
        if assigns_owner and ("business_unit_id" in self.model_fields_set) != ("responsible_id" in self.model_fields_set):
            raise ValueError("business_unit_id y responsible_id deben enviarse juntos")
        if not assigns_owner and self.workflow_status is None:
            raise ValueError("Indicá unidad y responsable, o un estado de trabajo")
        return self


class SafeMetadataUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    internal_name: str | None = Field(default=None, max_length=200)
    business_unit_id: int | None = Field(default=None, ge=1)
    responsible_id: int | None = Field(default=None, ge=1)
    classification_status: str = Field(default="pending", pattern="^(pending|assigned|review)$")
    inventory_scope: str = Field(default="pending", pattern="^(pending|business|internal)$")
    data_quality_status: str = Field(default="pending", pattern="^(pending|clean|obsolete|duplicate)$")
    workflow_status: str = Field(default="pending", pattern="^(pending|in_progress|blocked|resolved|retired)$")
    next_action: str | None = Field(default=None, max_length=200)

    @field_validator("next_action", mode="before")
    @classmethod
    def canonicalize_next_action(cls, value):
        return normalize_next_action(value)

    notes: str | None = Field(default=None, max_length=4000)
    assigned_by: str | None = Field(default=None, max_length=160)


class SafeScopeUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    inventory_scope: str = Field(pattern="^(pending|business|internal)$")


class SafeAccountTypeUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    account_type_classification: str = Field(pattern="^(nominal|no_nominal|internal)$")


class AccountInventoryClassificationUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    inventory_account_type: str | None = Field(default=None, pattern="^(nominal|no_nominal|internal)$")


class SafeQuickUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workflow_status: str = Field(pattern="^(pending|in_progress|blocked|resolved|retired)$")
    next_action: str | None = Field(default=None, max_length=200)

    @field_validator("next_action", mode="before")
    @classmethod
    def canonicalize_next_action(cls, value):
        return normalize_next_action(value)

    @model_validator(mode="after")
    def clear_action_when_resolved(self) -> "SafeQuickUpdate":
        if self.workflow_status == "resolved":
            self.next_action = None
        return self


class FindingUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str = Field(pattern="^(open|acknowledged|resolved|excepted)$")
    exception_reason: str | None = Field(default=None, max_length=2000)
    exception_until: datetime | None = None

    @field_validator("exception_reason")
    @classmethod
    def normalize_exception_reason(cls, value):
        return value.strip() if value else value


class DashboardWidgetFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workflow_status: str = Field(default="", pattern="^(|pending|in_progress|blocked|resolved|retired)$")
    classification_status: str = Field(default="", pattern="^(|pending|assigned|review)$")
    inventory_scope: str = Field(default="", pattern="^(|pending|business|internal)$")
    data_quality_status: str = Field(default="", pattern="^(|pending|clean|obsolete|duplicate)$")
    health_filter: str = Field(default="", pattern="^(|missing_cpm|no_accounts|retention_unconfigured|manage_safe_concentration)$")


class DashboardChart(BaseModel):
    model_config = ConfigDict(extra="forbid")

    style: str = Field(pattern="^(pie|bars|line|heatmap|scatter|combo)$")
    group_by: str = Field(pattern="^(" + "|".join(DASHBOARD_CHART_DIMENSIONS) + ")$")


# Personal dashboard visual layout: a fixed 3x2 grid of 6 zones (0-5, row-major).
# "sm" occupies its own zone; "md" spans two zones in the same row; "lg"
# spans a 2x2 block. Kept in sync with frontend/src/lib/dashboard-layout.ts.
DASHBOARD_ZONE_COLUMNS = 3
DASHBOARD_ZONE_ROWS = 2
DASHBOARD_SIZE_SPANS = {"sm": (1, 1), "md": (2, 1), "lg": (2, 2)}
DASHBOARD_MEASURES = (
    "safes", "accounts", "connections", "pam_users", "pam_roles", "sia_policies",
    "pam_sia_coverage", "zsp_coverage", "account_platform_coverage", "safe_account_coverage",
)
DASHBOARD_PERCENTAGE_MEASURES = frozenset({
    "pam_sia_coverage", "zsp_coverage", "account_platform_coverage", "safe_account_coverage",
})


def _zone_fits(position: int, size: str) -> bool:
    cols, rows = DASHBOARD_SIZE_SPANS.get(size, (1, 1))
    col, row = position % DASHBOARD_ZONE_COLUMNS, position // DASHBOARD_ZONE_COLUMNS
    return col + cols <= DASHBOARD_ZONE_COLUMNS and row + rows <= DASHBOARD_ZONE_ROWS


class DashboardWidget(BaseModel):
    model_config = ConfigDict(extra="forbid")

    widget_id: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")]
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    kind: str = Field(pattern="^(count|goal|chart)$")
    measure: str = Field(default="safes", pattern="^(" + "|".join(DASHBOARD_MEASURES) + ")$")
    value_format: str = Field(default="count", pattern="^(count|percentage)$")
    filters: DashboardWidgetFilters = Field(default_factory=DashboardWidgetFilters)
    chart: DashboardChart | None = None
    target_value: int | None = Field(default=None, ge=0, le=10000000)
    target_direction: str | None = Field(default=None, pattern="^(at_least|at_most)$")
    period_label: Annotated[str | None, StringConstraints(strip_whitespace=True, max_length=40)] = None
    baseline_value: int | None = Field(default=None, ge=0, le=10000000)
    size: str = Field(default="sm", pattern="^(sm|md|lg)$")
    position: int | None = Field(default=None, ge=0, le=5)

    @model_validator(mode="after")
    def _kind_consistency(self) -> "DashboardWidget":
        if self.kind == "goal" and (self.target_value is None or self.target_direction is None):
            raise ValueError("Un objetivo requiere valor y dirección de meta")
        if self.kind == "chart" and self.chart is None:
            raise ValueError("Un gráfico requiere estilo y dimensión")
        if self.kind == "chart" and self.measure not in ("safes", "accounts"):
            raise ValueError("Los gráficos agrupados sólo están disponibles para Safes y cuentas")
        advanced_dimensions = {
            "line": {"inventory_trend"},
            "heatmap": {"business_unit_workflow", "workflow_next_action"},
            "scatter": {"safe_accounts_members"},
            "combo": {"business_unit_inventory"},
        }
        if self.kind == "chart" and self.chart:
            expected_dimensions = advanced_dimensions.get(self.chart.style)
            if expected_dimensions and self.chart.group_by not in expected_dimensions:
                raise ValueError("El tipo de gráfico no coincide con el cruce seleccionado")
            if expected_dimensions and any(self.filters.model_dump().values()):
                raise ValueError("Los cruces preconfigurados no admiten filtros adicionales")
            advanced_group_bys = set().union(*advanced_dimensions.values())
            if not expected_dimensions and self.chart.group_by in advanced_group_bys:
                raise ValueError("Este cruce requiere su tipo de gráfico específico")
        if self.measure in DASHBOARD_PERCENTAGE_MEASURES and self.value_format != "percentage":
            raise ValueError("Esta métrica requiere formato porcentual")
        if self.measure not in DASHBOARD_PERCENTAGE_MEASURES and self.value_format != "count":
            raise ValueError("Esta métrica requiere formato de cantidad")
        if self.measure not in ("safes", "accounts") and any(self.filters.model_dump().values()):
            raise ValueError("Esta métrica no admite filtros de Safes")
        if self.kind != "chart":
            self.chart = None
        if self.kind != "goal":
            self.target_value = None
            self.target_direction = None
            self.period_label = None
            self.baseline_value = None
        if self.position is not None and not _zone_fits(self.position, self.size):
            raise ValueError("El bloque no entra en la zona seleccionada de la grilla visual de 6 zonas")
        return self


class DashboardPreferenceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    widgets: list[DashboardWidget] = Field(max_length=12)

    @field_validator("widgets")
    @classmethod
    def _unique_widget_ids(cls, widgets):
        ids = [widget.widget_id for widget in widgets]
        if len(ids) != len(set(ids)):
            raise ValueError("Los widgets no pueden repetir identificador")
        data_count = sum(widget.kind == "count" for widget in widgets)
        visual_count = len(widgets) - data_count
        if data_count > 6 or visual_count > 6:
            raise ValueError("La vista admite hasta 6 datos y 6 gráficos u objetivos")
        return widgets



class IngestionStart(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_safes: int = Field(default=0, ge=0, le=10000)
    page_size: int = Field(default=100, ge=1, le=250)
    member_delay_seconds: float = Field(default=0.3, ge=0, le=60)
    reconcile_complete: bool = False


class IngestionPreview(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_safes: int = Field(default=0, ge=0, le=10000)
    page_size: int = Field(default=100, ge=1, le=250)
    member_delay_seconds: float = Field(default=0.3, ge=0, le=60)
