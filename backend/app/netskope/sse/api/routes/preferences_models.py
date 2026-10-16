"""Response contracts for SSE dashboard preferences."""
from typing import Literal
from pydantic import BaseModel, ConfigDict

from app.netskope.sse.metric_contracts import MetricAdapter


class NetskopeMetricContractResponse(BaseModel):
    id: str
    kind: Literal['data', 'chart']
    adapter: MetricAdapter
    scope: str
    grain: str
    unit: str
    filter_keys: list[Literal['os', 'company', 'classification_status']]
    windows_days: list[int]
    denominator: str | None
    top_n: int | None
    drill: bool
    version: int
    permission: Literal['netskope:read']
    timezone: str
    contract_state: Literal['verified', 'not_configured', 'pending_validation', 'invalid']


class NetskopeWidgetInstanceRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    size: Literal['sm', 'md', 'lg']
    filters: dict[str, str]
    style: Literal['donut', 'bars'] | None = None


class NetskopeDashboardPreferencesResponse(BaseModel):
    widgets: list[NetskopeWidgetInstanceRow]
    data_widgets: list[str]
    chart_widgets: list[str]
    is_default: bool
