"""Stable response schemas for the personal preference surfaces (AUD-API-002).

These models belong to the PAM dashboard. Shared workspace/role templates
and Netskope widget instances stay in their respective owning modules. The
CyberArk dashboard widget is an envelope:
the definition fields always come from `schemas.DashboardWidget` (validated by
`_normalise_widgets` before evaluation), while the evaluation extras (`value`,
`buckets`, `chart_data`, `data_status`, `covered_count`, ...) only exist for
the branches that produce them. Those extras are declared optional and the
dashboard routes serialize with `response_model_exclude_unset=True`, so an
absent extra stays absent instead of turning into an invented `null` -- the
preferences payload is persisted and compared by the frontend, so an added
`buckets: null` would be a contract change, not a cosmetic one.

`chart_data` keeps the four advanced-visualization variants modeled as
optional fields (the same shape `frontend/src/cyberark/pam/lib/dashboard-metrics.ts`
already consumes); `extra="allow"` on the leaves means a future variant key
passes through instead of being silently dropped.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict


class DashboardWidgetFiltersRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    workflow_status: str
    classification_status: str
    inventory_scope: str
    data_quality_status: str
    health_filter: str


class DashboardChartRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    style: str
    group_by: str


class DashboardBucket(BaseModel):
    model_config = ConfigDict(extra="allow")

    key: str
    count: int
    # Basic charts carry the drill-down value; the roll-up "Otros" bucket is
    # built without it, which is why this stays optional.
    filter_value: str | None = None


class DashboardChartSeries(BaseModel):
    model_config = ConfigDict(extra="ignore")

    key: str
    label: str
    values: list[int]


class DashboardChartCell(BaseModel):
    model_config = ConfigDict(extra="allow")

    x: int
    y: int
    value: int
    filter_value: str | None = None


class DashboardChartPoint(BaseModel):
    model_config = ConfigDict(extra="allow")

    key: str
    label: str
    x: int
    y: int
    filter_value: str | None = None


class DashboardChartData(BaseModel):
    model_config = ConfigDict(extra="allow")

    labels: list[str] | None = None
    filter_values: list[str] | None = None
    series: list[DashboardChartSeries] | None = None
    x_labels: list[str] | None = None
    y_labels: list[str] | None = None
    cells: list[DashboardChartCell] | None = None
    points: list[DashboardChartPoint] | None = None


class DashboardWidgetRow(BaseModel):
    model_config = ConfigDict(extra="allow")

    widget_id: str
    title: str
    kind: str
    measure: str
    value_format: str
    filters: DashboardWidgetFiltersRow
    chart: DashboardChartRow | None = None
    target_value: int | None = None
    target_direction: str | None = None
    period_label: str | None = None
    # The PUT route can set this from an evaluated integer count, so it is
    # not forced to float (which would rewrite 315 as 315.0).
    baseline_value: int | float | None = None
    size: str
    position: int | None = None
    # Evaluation extras: only present when the producing branch returns them.
    value: int | float | None = None
    data_status: Literal['available', 'pending', 'unavailable'] | None = None
    total_accounts: int | None = None
    compliant_accounts: int | None = None
    measured_at: str | None = None
    covered_count: int | None = None
    total_count: int | None = None
    buckets: list[DashboardBucket] | None = None
    chart_data: DashboardChartData | None = None


class DashboardPreferencesResponse(BaseModel):
    widgets: list[DashboardWidgetRow]
    is_default: bool


class DashboardPreferencesPreviewResponse(BaseModel):
    widgets: list[DashboardWidgetRow]
