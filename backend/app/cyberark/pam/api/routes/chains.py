"""Cadenas: read-only, one-hop expansion and pivot search over the PAM graph."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.auth import require_any_permission_read
from app.cross.services.account_security import (
    get_actor_permissions,
)
from app.cyberark.pam.services.pam_read_models import (
    DEFAULT_LIMIT,
    MAX_LIMIT,
    SEARCH_TYPES,
    expand_chain_node,
    get_chain_node,
    search_chain_nodes,
)
from app.cross.api.routes.chain_models import ChainExpandResponse, ChainNodeResponse, ChainSearchResponse

NodeType = Literal["user", "role", "safe", "platform", "psm", "access_asset", "access_policy"]
Direction = Literal["forward", "back"]

router = APIRouter(tags=["Cadenas PAM"])


def _identity_payload(row: dict) -> dict | None:
    return row.get("identity")


def _node_payload(row: dict) -> dict:
    return {
        "identity": _identity_payload(row),
        "type": row["node_type"],
        "id": row["id"],
        "label": row["label"],
        "sublabel": row["sublabel"],
        "counts": {"forward": row["forward_count"], "back": row["back_count"]},
        "catalog_missing": bool(row.get("catalog_missing")),
        "restricted": bool(row.get("restricted")),
    }


def _hop_payload(row: dict) -> dict:
    return {
        "identity": _identity_payload(row),
        "type": row["node_type"],
        "id": row["id"],
        "label": row["label"],
        "sublabel": row["sublabel"],
        "relation": {"kind": row["relation_kind"], "basis": row["basis"]},
        "counts": {"forward": row["forward_count"], "back": row["back_count"]},
        "catalog_missing": bool(row.get("catalog_missing")),
        "restricted": bool(row.get("restricted")),
    }


async def _can_read_sia(request: Request, actor_id: str) -> bool:
    permissions = await get_actor_permissions(request.app.state.db, actor_id)
    return "access:manage" in permissions or "sia:catalogs_read" in permissions


async def _can_read_identity(request: Request, actor_id: str) -> bool:
    permissions = await get_actor_permissions(request.app.state.db, actor_id)
    return "access:manage" in permissions or "identity:catalogs_read" in permissions


def _selected_search_types(raw: str) -> tuple[str, ...]:
    if not raw.strip():
        return SEARCH_TYPES
    requested = tuple(dict.fromkeys(value.strip() for value in raw.split(",") if value.strip()))
    unknown = [value for value in requested if value not in SEARCH_TYPES]
    if unknown or not requested:
        raise HTTPException(
            status_code=422,
            detail=f"types debe ser un subconjunto de {', '.join(SEARCH_TYPES)}",
        )
    return requested


@router.get(
    "/api/chains/pam/node",
    response_model=ChainNodeResponse,
    summary="Consultar un nodo de la cadena PAM",
    description=(
        "Devuelve el nodo y cuántos eslabones puede expandir en cada dirección. "
        "Requiere access:manage o pam:catalogs_read."
    ),
)
async def pam_chain_node(
    request: Request,
    type: NodeType,
    id: int,
    include_internal: bool = True,
    actor_id: str = Depends(require_any_permission_read("access:manage", "pam:catalogs_read")),
):
    row = await get_chain_node(
        request.app.state.db, node_type=type, node_id=id, include_internal=include_internal,
        include_sia=await _can_read_sia(request, actor_id),
        include_identity=await _can_read_identity(request, actor_id),
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Nodo no encontrado")
    return {"node": _node_payload(row)}


@router.get(
    "/api/chains/pam/expand",
    response_model=ChainExpandResponse,
    summary="Expandir un eslabón de la cadena PAM",
    description=(
        "Devuelve los vecinos activos de un nodo en una dirección, paginados. "
        "Con permiso de Identity, cada usuario PAM trae la persona de Identity vinculada "
        "(UUID o correo exacto 1 a 1, nunca por nombre) en `identity`. "
        "Cada arista indica si es persistida o derivada y su base; con permiso SIA "
        "se suman los tramos terminales a políticas. "
        "Requiere access:manage o pam:catalogs_read."
    ),
)
async def pam_chain_expand(
    request: Request,
    type: NodeType,
    id: int,
    direction: Direction = "forward",
    include_internal: bool = True,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT,
    offset: Annotated[int, Query(ge=0)] = 0,
    actor_id: str = Depends(require_any_permission_read("access:manage", "pam:catalogs_read")),
):
    result = await expand_chain_node(
        request.app.state.db,
        node_type=type,
        node_id=id,
        direction=direction,
        include_internal=include_internal,
        include_sia=await _can_read_sia(request, actor_id),
        include_identity=await _can_read_identity(request, actor_id),
        query=q.strip(),
        limit=limit,
        offset=offset,
    )
    return {
        "type": type,
        "id": id,
        "direction": direction,
        "rows": [_hop_payload(row) for row in result["rows"]],
        "total": result["total"],
        "limit": result["limit"],
        "offset": result["offset"],
    }


@router.get(
    "/api/chains/pam/search",
    response_model=ChainSearchResponse,
    summary="Buscar nodos de la cadena PAM",
    description=(
        "Busca usuarios PAM (con access:manage o identity:catalogs_read también por el "
        "nombre o correo de la persona de Identity vinculada), roles, Safes, plataformas y PSM por nombre o identificador, "
        "agrupados por tipo (hasta 20 por tipo). Requiere access:manage o pam:catalogs_read."
    ),
)
async def pam_chain_search(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    types: Annotated[str, Query(max_length=120)] = "",
    standard_seat: Literal["", "reconciled", "unreconciled"] = "",
    status: Literal["", "suspended"] = "",
    include_internal: bool = True,
    actor_id: str = Depends(require_any_permission_read("access:manage", "pam:catalogs_read")),
):
    query = q.strip()
    if len(query) < 2 and not standard_seat and not status:
        raise HTTPException(status_code=422, detail="q debe contener al menos 2 caracteres")
    selected = _selected_search_types(types)
    result = await search_chain_nodes(
        request.app.state.db, query=query, node_types=selected,
        include_internal=include_internal, standard_seat=standard_seat, status=status,
        include_identity=await _can_read_identity(request, actor_id),
    )
    return {
        "query": result["query"],
        "groups": {
            node_type: [
                {
                    "type": row["node_type"], "id": row["id"], "label": row["label"],
                    "sublabel": row["sublabel"], "standard_seat_reconciled": bool(row.get("standard_seat_reconciled")),
                    "identity": _identity_payload(row),
                }
                for row in rows
            ]
            for node_type, rows in result["groups"].items()
        },
    }
