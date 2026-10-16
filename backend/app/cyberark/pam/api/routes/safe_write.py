from fastapi import APIRouter, Depends, HTTPException, Request

from app.auth import require_permission
from app.cyberark.pam.services.safe_classification import (
    CatalogReferenceError,
    assign_safe,
    bulk_assign_safes,
    classify_account,
    quick_update,
    set_account_type,
    set_scope,
    update_metadata,
)
from app.cyberark.pam.schemas import AccountInventoryClassificationUpdate, SafeAccountTypeUpdate, SafeAssignmentUpdate, SafeBulkAssignment, SafeMetadataUpdate, SafeQuickUpdate, SafeScopeUpdate
from app.cyberark.pam.api.routes.inventory_models import AccountClassificationResponse, BulkAssignmentResponse, SafeMutationResponse


router = APIRouter()


@router.patch(
    "/api/accounts/{safe_number}/{account_id}/classification",
    response_model=AccountClassificationResponse,
    summary="Clasificar cuenta del inventario",
    description="Actualiza el tipo de cuenta asignado manualmente en el inventario (no modifica CyberArk). Requiere safes:manage.",
)
async def update_account_classification_route(
    request: Request,
    safe_number: int,
    account_id: str,
    payload: AccountInventoryClassificationUpdate,
    actor_id: str = Depends(require_permission("safes:manage")),
):
    result = await classify_account(
        request.app.state.db, safe_number, account_id, payload.inventory_account_type, actor_id,
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")
    return result


async def _update_with_catalog_error(operation, request: Request, safe_number: int, payload, actor_id: str):
    try:
        result = await operation(request.app.state.db, safe_number, payload, actor_id)
    except CatalogReferenceError as exc:
        raise HTTPException(status_code=400, detail="Unidad o responsable inexistente") from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Safe no encontrada")
    return result


@router.patch(
    "/api/safes/{safe_number}/assignment",
    response_model=SafeMutationResponse,
    summary="Asignar unidad y responsable de un Safe",
    description="Actualiza unidad de negocio y responsable de una Safe. Requiere safes:manage.",
)
async def update_safe_assignment_route(
    request: Request,
    safe_number: int,
    payload: SafeAssignmentUpdate,
    actor_id: str = Depends(require_permission("safes:manage")),
):
    return await _update_with_catalog_error(assign_safe, request, safe_number, payload, actor_id)


@router.patch(
    "/api/safes/{safe_number}/scope",
    response_model=SafeMutationResponse,
    summary="Actualizar alcance de negocio de un Safe",
    description="Marca una Safe como de alcance de negocio o interno; nunca se infiere sólo por patrón de nombre. Requiere safes:manage.",
)
async def update_safe_scope_route(
    request: Request,
    safe_number: int,
    payload: SafeScopeUpdate,
    actor_id: str = Depends(require_permission("safes:manage")),
):
    result = await set_scope(request.app.state.db, safe_number, payload, actor_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Safe no encontrada")
    return result


@router.patch(
    "/api/safes/{safe_number}/account-type",
    response_model=SafeMutationResponse,
    summary="Actualizar tipo de cuenta por defecto de un Safe",
    description="Cambia el tipo de cuenta asignado por defecto a las cuentas nuevas de la Safe. Requiere safes:manage.",
)
async def update_safe_account_type_route(
    request: Request,
    safe_number: int,
    payload: SafeAccountTypeUpdate,
    actor_id: str = Depends(require_permission("safes:manage")),
):
    result = await set_account_type(request.app.state.db, safe_number, payload, actor_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Safe no encontrada")
    return result


@router.post(
    "/api/safes/bulk-assignment",
    response_model=BulkAssignmentResponse,
    summary="Asignar unidad y responsable a varios Safes",
    description="Aplica la misma unidad de negocio, responsable y/o estado de flujo a hasta 500 Safes en una sola operación auditada. Requiere safes:manage.",
)
async def bulk_update_safe_assignment_route(
    request: Request,
    payload: SafeBulkAssignment,
    actor_id: str = Depends(require_permission("safes:manage")),
):
    try:
        return await bulk_assign_safes(request.app.state.db, payload, actor_id)
    except CatalogReferenceError as exc:
        raise HTTPException(status_code=400, detail="Unidad o responsable inexistente") from exc


@router.patch(
    "/api/safes/{safe_number}/metadata",
    response_model=SafeMutationResponse,
    summary="Actualizar metadatos completos de un Safe",
    description="Actualiza en un solo paso unidad, responsable, estado de clasificación, alcance, calidad de datos, estado de flujo y próxima acción. Requiere safes:manage.",
)
async def update_safe_metadata_route(
    request: Request,
    safe_number: int,
    payload: SafeMetadataUpdate,
    actor_id: str = Depends(require_permission("safes:manage")),
):
    return await _update_with_catalog_error(update_metadata, request, safe_number, payload, actor_id)


@router.patch(
    "/api/safes/{safe_number}/quick-update",
    response_model=SafeMutationResponse,
    summary="Actualización rápida de un Safe",
    description="Actualiza un único campo de clasificación desde la tabla de inventario sin abrir el detalle completo. Requiere safes:manage.",
)
async def update_safe_quick_route(
    request: Request,
    safe_number: int,
    payload: SafeQuickUpdate,
    actor_id: str = Depends(require_permission("safes:manage")),
):
    result = await quick_update(request.app.state.db, safe_number, payload, actor_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Safe no encontrada")
    return result
