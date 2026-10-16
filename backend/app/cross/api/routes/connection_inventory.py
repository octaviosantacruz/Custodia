from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field, field_validator

from app.auth import require_permission, require_permission_read
from app.cross.services.connection_inventory_import import (
    DestinationConflict,
    add_destination,
    apply_import,
    edit_destinations,
    coverage_progress,
    export_destinations_csv,
    preview_import,
    take_coverage_snapshot,
)
from app.cross.services.inventory_views import destination_history, get_capability_deviations, list_connection_inventory, list_stale_destinations, list_uninventoried_addresses
from app.cross.services.sia_policy_capabilities import classify_policies, policies_with_suggestions
from app.cross.api.routes.connection_inventory_models import (
    ConnectionDestinationChanged,
    ConnectionDeviationsResponse,
    ConnectionHistoryResponse,
    CoverageProgress,
    CoverageProgressResponse,
    StaleDestinationsResponse,
    UninventoriedAddressesResponse,
    WorkStatus,
    SiaPolicyCapabilitiesResponse,
    ConnectionDestinationsChanged,
    ConnectionInventoryImportedResponse,
    ConnectionInventoryPreviewResponse,
    ConnectionInventoryResponse,
)


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
    # Only a file that carries these columns overrides what people set in the inventory (None = keep).
    work_status: WorkStatus | None = None
    responsible: str | None = Field(default=None, max_length=120)
    note: str | None = Field(default=None, max_length=1000)

    @field_validator("private_ip")
    @classmethod
    def validate_ip(cls, value: str) -> str:
        import ipaddress
        normalized = value.strip()
        ipaddress.ip_address(normalized)
        return normalized


class DestinationValues(BaseModel):
    work_status: WorkStatus | None = None
    responsible: str | None = Field(default=None, max_length=120)
    note: str | None = Field(default=None, max_length=1000)
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
        ipaddress.ip_address(value.strip())
        return value.strip()


class DestinationUpdate(BaseModel):
    """Only the fields sent change; ``null`` on a flag clears it to "sin dato"."""

    instance_name: str | None = Field(default=None, min_length=1, max_length=240)
    environment: str | None = Field(default=None, max_length=80)
    private_ip: str | None = Field(default=None, min_length=1, max_length=80)
    port: int | None = Field(default=None, ge=1, le=65535)
    ca_sia: bool | None = None
    ca_dba: bool | None = None
    zsp_implemented: bool | None = None
    access_available: bool | None = None
    description: str | None = Field(default=None, max_length=1000)
    lifecycle_status: Literal["active", "retired"] | None = None
    work_status: WorkStatus | None = None
    responsible: str | None = Field(default=None, max_length=120)
    note: str | None = Field(default=None, max_length=1000)

    @field_validator("private_ip")
    @classmethod
    def validate_ip(cls, value: str | None) -> str | None:
        if value is None:
            return value
        import ipaddress
        ipaddress.ip_address(value.strip())
        return value.strip()

    def changes(self) -> dict:
        # `instance_name`, `environment`, `private_ip`, `description` and `lifecycle_status` cannot be cleared
        # to null: a null there means "not sent".
        sent = self.model_dump(exclude_unset=True)
        return {key: value for key, value in sent.items() if value is not None or key in ("port", "ca_sia", "ca_dba", "zsp_implemented", "access_available")}


class DestinationBulkUpdate(BaseModel):
    inventory_ids: list[int] = Field(min_length=1, max_length=500)
    changes: DestinationUpdate


class ConnectionInventoryImport(BaseModel):
    file_name: str = Field(min_length=1, max_length=255)
    rows: list[ConnectionInventoryRow] = Field(max_length=10000)
    mode: Literal["update", "replace"] = "update"


router = APIRouter(tags=["Inventario de conexiones"])


@router.get(
    "/api/connection-inventory",
    response_model=ConnectionInventoryResponse,
    summary="Inventario de conexiones por IP",
    description="Inventario importado por IP con su coincidencia exacta contra PAM y SIA. Nunca incluye credenciales. Requiere coverage:read.",
)
async def connection_inventory(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    include_internal: bool = Query(True),
    environment: Annotated[str, Query(max_length=80)] = "",
    coverage: Annotated[str, Query(pattern="^(|both|pam_only|sia_only|none)$")] = "",
    status: Annotated[str, Query(pattern="^(active|retired|all)$")] = "active",
    deviation: Annotated[str, Query(pattern="^(|platform|dba|any)$")] = "",
    work_status: Annotated[str, Query(pattern="^(|pending|in_progress|onboarded|blocked|not_applicable)$")] = "",
    responsible: Annotated[str, Query(max_length=120)] = "",
    actor_id: str = Depends(require_permission_read("coverage:read")),
):
    return await list_connection_inventory(
        request.app.state.db, q.strip(), limit, offset, include_internal, environment.strip(), coverage, status, deviation, work_status, responsible.strip(),
    )


@router.post(
    "/api/connection-inventory/import/preview",
    response_model=ConnectionInventoryPreviewResponse,
    summary="Previsualizar importación del inventario de destinos",
    description="Calcula sin escribir qué agregaría, cambiaría o retiraría una importación por IP y puerto; requiere coverage:manage.",
)
async def preview_connection_inventory_import(
    payload: ConnectionInventoryImport,
    request: Request,
    actor_id: str = Depends(require_permission("coverage:manage")),
):
    return await preview_import(request.app.state.db, [row.model_dump() for row in payload.rows], payload.mode)


@router.post(
    "/api/connection-inventory/import",
    response_model=ConnectionInventoryImportedResponse,
    summary="Importar inventario de destinos",
    description=(
        "Actualiza y agrega destinos por IP y puerto; en modo update lo que falta en el archivo queda Retirado y en "
        "modo replace el inventario queda igual al archivo. Nunca borra filas de snapshots anteriores. "
        "Requiere coverage:manage y queda auditado."
    ),
)
async def import_connection_inventory(
    payload: ConnectionInventoryImport,
    request: Request,
    actor_id: str = Depends(require_permission("coverage:manage")),
):
    try:
        import_id, summary = await apply_import(
            request.app.state.db, [row.model_dump() for row in payload.rows], payload.file_name.strip(), payload.mode, actor_id,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return {"imported": True, "import_id": str(import_id), "row_count": summary["counts"]["incoming"], "mode": payload.mode, "counts": summary["counts"]}


@router.get(
    "/api/connection-inventory/export.csv",
    summary="Exportar inventario de destinos",
    description="CSV de los destinos activos con las columnas importables más lo observado en Safes y SIA; sin credenciales, con fórmulas neutralizadas y auditado. Requiere coverage:manage.",
)
async def export_connection_inventory_csv(
    request: Request,
    actor_id: str = Depends(require_permission_read("coverage:manage")),
):
    content = await export_destinations_csv(request.app.state.db, actor_id)
    return Response(
        content="\ufeff" + content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=\"dshub-destinos.csv\""},
    )


@router.post(
    "/api/connection-inventory",
    status_code=201,
    response_model=ConnectionDestinationChanged,
    summary="Agregar un destino",
    description="Alta manual de un destino por IP y puerto en el inventario actual; auditada. Requiere coverage:manage.",
)
async def create_connection_destination(
    payload: DestinationValues,
    request: Request,
    actor_id: str = Depends(require_permission("coverage:manage")),
):
    try:
        inventory_id = await add_destination(request.app.state.db, payload.model_dump(), actor_id)
    except DestinationConflict as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return {"inventory_id": inventory_id}


@router.patch(
    "/api/connection-inventory/{inventory_id}",
    response_model=ConnectionDestinationsChanged,
    summary="Editar, retirar o reactivar un destino",
    description="Cambia sólo los campos enviados; retirar no borra y reactivar lo devuelve a Activo. Auditado por campo. Requiere coverage:manage.",
)
async def update_connection_destination(
    inventory_id: int,
    payload: DestinationUpdate,
    request: Request,
    actor_id: str = Depends(require_permission("coverage:manage")),
):
    return await _edit(request, [inventory_id], payload, actor_id)


@router.post(
    "/api/connection-inventory/bulk-update",
    response_model=ConnectionDestinationsChanged,
    summary="Editar destinos en lote",
    description="Aplica el mismo cambio de ambiente, banderas o estado a hasta 500 destinos en una transacción, auditado por fila. Requiere coverage:manage.",
)
async def bulk_update_connection_destinations(
    payload: DestinationBulkUpdate,
    request: Request,
    actor_id: str = Depends(require_permission("coverage:manage")),
):
    return await _edit(request, payload.inventory_ids, payload.changes, actor_id)


async def _edit(request: Request, ids: list[int], payload: DestinationUpdate, actor_id: str):
    try:
        changed = await edit_destinations(request.app.state.db, ids, payload.changes(), actor_id)
    except DestinationConflict as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return {"changed": changed}


class PolicyCapability(BaseModel):
    policy_source_id: str = Field(min_length=1, max_length=200)
    capability: Literal["platform", "dba", "other"] | None = None


class PolicyCapabilities(BaseModel):
    items: list[PolicyCapability] = Field(min_length=1, max_length=200)


@router.get(
    "/api/connection-inventory/deviations",
    response_model=ConnectionDeviationsResponse,
    summary="Desvíos de cobertura por capacidad",
    description="Destinos activos por lectura de Platform y de DBA (coincide, falta, no declarado, sin clasificar, sin dato) y cuántas políticas SIA están clasificadas. Requiere coverage:read.",
)
async def connection_deviations(request: Request, actor_id: str = Depends(require_permission_read("coverage:read"))):
    return await get_capability_deviations(request.app.state.db)


@router.get(
    "/api/connection-inventory/sia-policies",
    response_model=SiaPolicyCapabilitiesResponse,
    summary="Políticas SIA y su clasificación",
    description="Políticas SIA activas con la clasificación Platform, DBA u otra que le dio una persona y una sugerencia por nombre, sólo para confirmar. Requiere coverage:read.",
)
async def sia_policy_capabilities(request: Request, actor_id: str = Depends(require_permission_read("coverage:read"))):
    return {"rows": await policies_with_suggestions(request.app.state.db)}


@router.put(
    "/api/connection-inventory/sia-policies",
    response_model=ConnectionDestinationsChanged,
    summary="Clasificar políticas SIA",
    description="Fija o quita (capability null) la clasificación de varias políticas SIA en una transacción, auditada por política. Un sync no la pisa. Requiere coverage:manage.",
)
async def classify_sia_policies(
    payload: PolicyCapabilities,
    request: Request,
    actor_id: str = Depends(require_permission("coverage:manage")),
):
    try:
        changed = await classify_policies(request.app.state.db, [item.model_dump() for item in payload.items], actor_id)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return {"changed": changed}


@router.get(
    "/api/connection-inventory/{inventory_id}/history",
    response_model=ConnectionHistoryResponse,
    summary="Historial de un destino",
    description="Cambios auditados de un destino (misma IP y puerto en todas las importaciones): quién, cuándo y qué campos. Requiere coverage:read.",
)
async def connection_destination_history(inventory_id: int, request: Request, actor_id: str = Depends(require_permission_read("coverage:read"))):
    return {"rows": await destination_history(request.app.state.db, inventory_id)}


@router.get(
    "/api/connection-inventory/progress",
    response_model=CoverageProgressResponse,
    summary="Avance de la cobertura de destinos",
    description="«X de N» por capacidad (Platform y DBA) y por estado de trabajo, total y por ambiente, más la serie semanal de las fotos registradas. Requiere coverage:read.",
)
async def connection_progress(request: Request, actor_id: str = Depends(require_permission_read("coverage:read"))):
    return await coverage_progress(request.app.state.db)


@router.post(
    "/api/connection-inventory/progress/snapshot",
    response_model=CoverageProgress,
    summary="Guardar la foto de hoy",
    description="Registra los conteos de hoy para la serie semanal (la última foto del día reemplaza a las anteriores). Requiere coverage:manage.",
)
async def snapshot_connection_progress(request: Request, actor_id: str = Depends(require_permission("coverage:manage"))):
    return await take_coverage_snapshot(request.app.state.db)


@router.get(
    "/api/connection-inventory/stale",
    response_model=StaleDestinationsResponse,
    summary="Destinos sin movimiento",
    description="Destinos activos pendientes, en curso o bloqueados cuyo estado de trabajo no cambió en los últimos N días (último cambio auditado, o la primera importación donde aparecieron). Requiere coverage:read.",
)
async def connection_stale_destinations(
    request: Request,
    days: Annotated[int, Query(ge=1, le=365)] = 14,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    actor_id: str = Depends(require_permission_read("coverage:read")),
):
    return await list_stale_destinations(request.app.state.db, days, limit)


@router.get(
    "/api/connection-inventory/uninventoried",
    response_model=UninventoriedAddressesResponse,
    summary="Direcciones sin inventariar",
    description="IPv4 que una cuenta de PAM o una regla de política SIA nombran y que ningún destino del inventario actual tiene (comparación exacta; sin hostnames ni rangos). Sólo lectura; el alta usa POST /api/connection-inventory. Requiere coverage:read.",
)
async def connection_uninventoried_addresses(
    request: Request,
    include_internal: bool = Query(True),
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    actor_id: str = Depends(require_permission_read("coverage:read")),
):
    return await list_uninventoried_addresses(request.app.state.db, include_internal, limit)
