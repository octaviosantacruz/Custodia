from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field, field_validator

from ...auth import require_permission, require_read_access
from ...repositories.connection_inventory import list_connection_inventory, replace_connection_inventory


class ConnectionInventoryRow(BaseModel):
    source_row_number: int = Field(ge=2)
    instance_name: str = Field(min_length=1, max_length=240)
    environment: str = Field(default="", max_length=80)
    private_ip: str = Field(min_length=1, max_length=80)
    port: int | None = Field(default=None, ge=1, le=65535)
    ca_sia: bool | None = None
    ca_dba: bool | None = None
    zsp_implemented: bool | None = None
    access_available: bool | None = None
    description: str = Field(default="", max_length=1000)

    @field_validator("private_ip")
    @classmethod
    def validate_ip(cls, value: str) -> str:
        import ipaddress
        normalized = value.strip()
        ipaddress.ip_address(normalized)
        return normalized


class ConnectionInventoryImport(BaseModel):
    file_name: str = Field(min_length=1, max_length=255)
    rows: list[ConnectionInventoryRow] = Field(max_length=10000)


router = APIRouter(tags=["Inventario de conexiones"])


@router.get("/api/connection-inventory", summary="Inventario de conexiones por IP")
async def connection_inventory(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    include_internal: bool = Query(True),
    environment: Annotated[str, Query(max_length=80)] = "",
    coverage: Annotated[str, Query(pattern="^(|both|pam_only|sia_only|none)$")] = "",
    actor_id: str = Depends(require_read_access),
):
    return await list_connection_inventory(
        request.app.state.db, q.strip(), limit, offset, include_internal, environment.strip(), coverage,
    )


@router.post("/api/connection-inventory/import", summary="Importar inventario de conexiones")
async def import_connection_inventory(
    payload: ConnectionInventoryImport,
    request: Request,
    actor_id: str = Depends(require_permission("connections:import")),
):
    import_id = await replace_connection_inventory(
        request.app.state.db,
        [row.model_dump() for row in payload.rows],
        payload.file_name.strip(),
        actor_id,
    )
    return {"imported": True, "import_id": str(import_id), "row_count": len(payload.rows)}
