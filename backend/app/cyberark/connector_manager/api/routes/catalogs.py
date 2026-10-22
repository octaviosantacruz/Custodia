from typing import Literal

from fastapi import APIRouter, Depends, HTTPException

from app.auth import require_any_permission_read
from app.cyberark.connector_manager.api.routes.catalog_models import NetworksResponse, PoolsResponse
from app.cyberark.connector_manager.integrations.connector_manager import (
    ConnectorManagerClient,
    ConnectorManagerError,
    ConnectorManagerNotConfigured,
    ConnectorManagerSettings,
)
from app.cyberark.connector_manager.services.catalogs import get_catalog

router = APIRouter(
    prefix="/api/connector-manager",
    tags=["CyberArk Connector Manager"],
    dependencies=[Depends(require_any_permission_read("access:manage", "pam:catalogs_read"))],
)


async def _read(catalog: Literal["pools", "networks"]):
    try:
        async with ConnectorManagerClient(ConnectorManagerSettings.from_environment()) as client:
            return await get_catalog(client, catalog)
    except ConnectorManagerNotConfigured:
        raise HTTPException(503, "Connector Manager no está configurado. Revisá la configuración compartida de CyberArk.") from None
    except ConnectorManagerError:
        raise HTTPException(502, "No se pudo consultar el catálogo completo de Connector Manager. Verificá disponibilidad y permisos de lectura.") from None


@router.get("/pools", response_model=PoolsResponse, summary="Pools de Connector Manager en vivo",
            description="Consulta todas las páginas del catálogo aprobado y devuelve nombres, descripción, fechas y conteos. Requiere pam:catalogs_read o access:manage. No persiste payloads ni devuelve valores de red, hostnames o identificadores de destinos.")
async def pools():
    return await _read("pools")


@router.get("/networks", response_model=NetworksResponse, summary="Redes de Connector Manager en vivo",
            description="Consulta todas las páginas de redes y devuelve nombres, fechas y cantidad de pools asociados. Requiere pam:catalogs_read o access:manage. No devuelve valores de red ni los identificadores o nombres de los pools asociados, y no modifica CyberArk.")
async def networks():
    return await _read("networks")
