from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class CatalogRow(BaseModel):
    id: str
    name: str
    created_at: datetime | None
    updated_at: datetime | None


class PoolRow(CatalogRow):
    description: str | None
    assigned_network_count: int | None
    identifiers_count: int | None
    platform_connectors_count: int | None
    access_connectors_count: int | None


class NetworkRow(CatalogRow):
    assigned_pool_count: int | None


class CatalogEvidence(BaseModel):
    source_system: Literal["cyberark_connector_manager"]
    queried_at: datetime
    total: int


class PoolsResponse(CatalogEvidence):
    catalog: Literal["pools"]
    rows: list[PoolRow]


class NetworksResponse(CatalogEvidence):
    catalog: Literal["networks"]
    rows: list[NetworkRow]
