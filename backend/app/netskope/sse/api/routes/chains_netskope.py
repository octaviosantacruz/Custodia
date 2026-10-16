"""Cadenas: read-only, one-hop expansion of the Netskope inventory chain."""

from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, Request

from app.netskope.sse.services.netskope_read_models import (
    DEFAULT_LIMIT,
    MAX_LIMIT,
    SEARCH_TYPES,
    expand_netskope_chain_node,
    get_netskope_chain_node,
    search_netskope_chain_nodes,
)
from app.cross.api.routes.chain_models import ChainExpandResponse, ChainNodeResponse, ChainSearchResponse
from app.cross.api.routes.cmdb_dependencies import NETSKOPE_CATALOG_DEPENDENCIES

NodeType = Literal["netskope_user", "netskope_device", "netskope_client_version", "netskope_os"]
Direction = Literal["forward", "back"]
router = APIRouter(tags=["Cadenas Netskope"])


def _node_payload(row: dict) -> dict:
    return {
        "type": row["node_type"],
        "id": row["id"],
        "label": row["label"],
        "sublabel": row["sublabel"],
        "counts": {"forward": row["forward_count"], "back": row["back_count"]},
    }


def _hop_payload(row: dict) -> dict:
    return {
        "type": row["node_type"],
        "id": row["id"],
        "label": row["label"],
        "sublabel": row["sublabel"],
        "relation": {"kind": row["relation_kind"], "basis": row["basis"]},
        "counts": {"forward": row["forward_count"], "back": row["back_count"]},
        "restricted": False,
    }


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
    "/api/chains/netskope/node",
    response_model=ChainNodeResponse,
    dependencies=NETSKOPE_CATALOG_DEPENDENCIES,
    summary="Consultar un nodo de la cadena Netskope",
    description=(
        "Devuelve un usuario o dispositivo Netskope y cuántos eslabones puede expandir. "
        "Requiere access:manage o netskope:read."
    ),
)
async def netskope_chain_node(
    request: Request,
    type: NodeType,
    id: int,
):
    row = await get_netskope_chain_node(request.app.state.db, node_type=type, node_id=id)
    if row is None:
        raise HTTPException(status_code=404, detail="Nodo no encontrado")
    return {"node": _node_payload(row)}


@router.get(
    "/api/chains/netskope/expand",
    response_model=ChainExpandResponse,
    dependencies=NETSKOPE_CATALOG_DEPENDENCIES,
    summary="Expandir un eslabón de la cadena Netskope",
    description=(
        "Devuelve los vecinos de un nodo: usuario ↔ dispositivo solo con match exacto "
        "1 a 1 (`observed_user`), y dispositivo → versión de cliente / SO como "
        "agrupaciones por atributo, nunca como relación persistida. "
        "Requiere access:manage o netskope:read."
    ),
)
async def netskope_chain_expand(
    request: Request,
    type: NodeType,
    id: int,
    direction: Direction = "forward",
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    result = await expand_netskope_chain_node(
        request.app.state.db,
        node_type=type,
        node_id=id,
        direction=direction,
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
    "/api/chains/netskope/search",
    response_model=ChainSearchResponse,
    dependencies=NETSKOPE_CATALOG_DEPENDENCIES,
    summary="Buscar nodos de la cadena Netskope",
    description=(
        "Busca usuarios y dispositivos Netskope por nombre, identificador, correo o "
        "username observado, agrupados por tipo. Requiere access:manage o netskope:read."
    ),
)
async def netskope_chain_search(
    request: Request,
    q: Annotated[str, Query(min_length=2, max_length=160)],
    types: Annotated[str, Query(max_length=120)] = "",
):
    query = q.strip()
    if len(query) < 2:
        raise HTTPException(status_code=422, detail="q debe contener al menos 2 caracteres")
    selected = _selected_search_types(types)
    result = await search_netskope_chain_nodes(request.app.state.db, query=query, node_types=selected)
    return {
        "query": result["query"],
        "groups": {
            node_type: [
                {"type": row["node_type"], "id": row["id"], "label": row["label"], "sublabel": row["sublabel"]}
                for row in rows
            ]
            for node_type, rows in result["groups"].items()
        },
    }
