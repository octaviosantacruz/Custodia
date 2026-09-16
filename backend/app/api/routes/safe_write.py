from fastapi import APIRouter, Depends, HTTPException, Request

from ...auth import require_permission
from ...repositories import update_account_inventory_classification, update_safe_account_type, update_safe_assignment, update_safe_metadata, update_safe_quick, update_safe_scope
from ...repositories.catalogs import is_foreign_key_violation
from ...repositories.safe_mutations import bulk_update_safe_assignment
from ...schemas import AccountInventoryClassificationUpdate, SafeAccountTypeUpdate, SafeAssignmentUpdate, SafeBulkAssignment, SafeMetadataUpdate, SafeQuickUpdate, SafeScopeUpdate


router = APIRouter()


@router.patch(
    "/api/accounts/{safe_number}/{account_id}/classification",
    summary="Clasificar cuenta del inventario",
    description="Actualiza el tipo de cuenta asignado manualmente en el inventario (no modifica CyberArk). Requiere safes:classify.",
)
async def update_account_classification_route(
    request: Request,
    safe_number: int,
    account_id: str,
    payload: AccountInventoryClassificationUpdate,
    actor_id: str = Depends(require_permission("safes:classify")),
):
    result = await update_account_inventory_classification(
        request.app.state.db, safe_number, account_id, payload.inventory_account_type, actor_id,
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")
    return result


async def _update_with_catalog_error(operation, request: Request, safe_number: int, payload, actor_id: str):
    try:
        result = await operation(request.app.state.db, safe_number, payload, actor_id)
    except Exception as exc:
        if is_foreign_key_violation(exc):
            raise HTTPException(status_code=400, detail="Unidad o responsable inexistente") from exc
        raise
    if result is None:
        raise HTTPException(status_code=404, detail="Safe no encontrada")
    return result


@router.patch(
    "/api/safes/{safe_number}/assignment",
    summary="Asignar unidad y responsable de un Safe",
    description="Actualiza unidad de negocio y responsable de una Safe. Requiere safes:classify.",
)
async def update_safe_assignment_route(
    request: Request,
    safe_number: int,
    payload: SafeAssignmentUpdate,
    actor_id: str = Depends(require_permission("safes:classify")),
):
    return await _update_with_catalog_error(update_safe_assignment, request, safe_number, payload, actor_id)


@router.patch(
    "/api/safes/{safe_number}/scope",
    summary="Actualizar alcance de negocio de un Safe",
    description="Marca una Safe como de alcance de negocio o interno; nunca se infiere sólo por patrón de nombre. Requiere safes:classify.",
)
async def update_safe_scope_route(
    request: Request,
    safe_number: int,
    payload: SafeScopeUpdate,
    actor_id: str = Depends(require_permission("safes:classify")),
):
    result = await update_safe_scope(request.app.state.db, safe_number, payload, actor_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Safe no encontrada")
    return result


@router.patch(
    "/api/safes/{safe_number}/account-type",
    summary="Actualizar tipo de cuenta por defecto de un Safe",
    description="Cambia el tipo de cuenta asignado por defecto a las cuentas nuevas de la Safe. Requiere safes:classify.",
)
async def update_safe_account_type_route(
    request: Request,
    safe_number: int,
    payload: SafeAccountTypeUpdate,
    actor_id: str = Depends(require_permission("safes:classify")),
):
    result = await update_safe_account_type(request.app.state.db, safe_number, payload, actor_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Safe no encontrada")
    return result


@router.post(
    "/api/safes/bulk-assignment",
    summary="Asignar unidad y responsable a varios Safes",
    description="Aplica la misma unidad de negocio, responsable y/o estado de flujo a hasta 500 Safes en una sola operación auditada. Requiere safes:bulk_classify.",
)
async def bulk_update_safe_assignment_route(
    request: Request,
    payload: SafeBulkAssignment,
    actor_id: str = Depends(require_permission("safes:bulk_classify")),
):
    try:
        return await bulk_update_safe_assignment(request.app.state.db, payload, actor_id)
    except Exception as exc:
        if is_foreign_key_violation(exc):
            raise HTTPException(status_code=400, detail="Unidad o responsable inexistente") from exc
        raise


@router.patch(
    "/api/safes/{safe_number}/metadata",
    summary="Actualizar metadatos completos de un Safe",
    description="Actualiza en un solo paso unidad, responsable, estado de clasificación, alcance, calidad de datos, estado de flujo y próxima acción. Requiere safes:classify.",
)
async def update_safe_metadata_route(
    request: Request,
    safe_number: int,
    payload: SafeMetadataUpdate,
    actor_id: str = Depends(require_permission("safes:classify")),
):
    return await _update_with_catalog_error(update_safe_metadata, request, safe_number, payload, actor_id)


@router.patch(
    "/api/safes/{safe_number}/quick-update",
    summary="Actualización rápida de un Safe",
    description="Actualiza un único campo de clasificación desde la tabla de inventario sin abrir el detalle completo. Requiere safes:classify.",
)
async def update_safe_quick_route(
    request: Request,
    safe_number: int,
    payload: SafeQuickUpdate,
    actor_id: str = Depends(require_permission("safes:classify")),
):
    result = await update_safe_quick(request.app.state.db, safe_number, payload, actor_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Safe no encontrada")
    return result
