"""Stable response schemas for the Access space CMDB surface (AUD-API-002).

`attributes` stays an opaque JSON object on purpose: it carries the
Access-space field set decided by the ingestion mapping, and some values are
polymorphic in the observed payloads (for example `port` arrives as a number
or a string). `platform_name` is nullable because it comes from a LEFT JOIN
against the PAM platform catalog, which may not resolve.
"""

from typing import Any

from pydantic import BaseModel, ConfigDict


class AccessAssetRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    object_id: int
    display_name: str
    source_id: str
    attributes: dict[str, Any]
    platform_name: str | None = None


class AccessAssetsResponse(BaseModel):
    rows: list[AccessAssetRow]
    total: int
    limit: int
    offset: int
    search: str
    asset_type: str
