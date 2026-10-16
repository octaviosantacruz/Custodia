"""Admin-configured Netskope compliance baselines (NSK-VER-001 / NSK-FLT-001).

Reading needs the Netskope catalog permission; changing a baseline needs
`netskope:admin` and is audited. Baselines are never inferred from the data
or fetched from the internet."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field, field_validator

from app.auth import require_any_permission_read, require_permission
from app.netskope.sse.services.netskope_state import (
    get_netskope_baselines,
    save_netskope_baseline,
)
from app.netskope.sse.services.netskope_read_models import (
    parse_version,
)

router = APIRouter(prefix="/api/netskope/baselines", tags=["Postura Netskope"])
READ = [Depends(require_any_permission_read("access:manage", "netskope:read"))]

Version = Annotated[str, Field(min_length=1, max_length=40)]


def _checked_version(value: str, label: str) -> str:
    cleaned = value.strip()
    if parse_version(cleaned) is None:
        raise ValueError(f"{label} debe empezar con una versión numérica (por ejemplo 141.0.0)")
    return cleaned


class GoldenReleasesPayload(BaseModel):
    releases: list[Version] = Field(min_length=2, max_length=12)
    note: str | None = Field(default=None, max_length=500)

    @field_validator("releases")
    @classmethod
    def validate_releases(cls, values: list[str]) -> list[str]:
        cleaned = [_checked_version(value, "Cada release golden") for value in values]
        keys = [tuple(parse_version(value)) for value in cleaned]
        if len(set(keys)) != len(keys):
            raise ValueError("Las releases golden no pueden repetirse")
        # Stored newest first so "1 golden atrás" is always the second entry.
        return [value for _, value in sorted(zip(keys, cleaned, strict=True), reverse=True)]


class OsMinimumsPayload(BaseModel):
    minimums: dict[Annotated[str, Field(min_length=1, max_length=60)], Version] = Field(min_length=1, max_length=10)
    note: str | None = Field(default=None, max_length=500)

    @field_validator("minimums")
    @classmethod
    def validate_minimums(cls, values: dict[str, str]) -> dict[str, str]:
        cleaned: dict[str, str] = {}
        for os_name, version in values.items():
            name = os_name.strip()
            if not name:
                raise ValueError("El sistema operativo no puede estar vacío")
            if name in cleaned:
                raise ValueError(f"{name} aparece más de una vez")
            cleaned[name] = _checked_version(version, f"La versión mínima de {name}")
        return cleaned


def _note(value: str | None) -> str | None:
    return value.strip() or None if value else None


@router.get("", summary="Líneas base Netskope", description="Releases golden del cliente y versiones mínimas de SO configuradas por un admin, con quién y cuándo las cambió.", dependencies=READ)
async def netskope_baselines(request: Request):
    return await get_netskope_baselines(request.app.state.db)


@router.put("/client-golden-releases", summary="Configurar releases golden del cliente Netskope", description="Requiere netskope:admin; queda auditado.")
async def update_golden_releases(payload: GoldenReleasesPayload, request: Request, actor_id: str = Depends(require_permission("netskope:admin"))):
    return await save_netskope_baseline(request.app.state.db, "client_golden_releases", {"releases": payload.releases}, _note(payload.note), actor_id)


@router.put("/os-minimum-versions", summary="Configurar versiones mínimas de SO Netskope", description="Requiere netskope:admin; queda auditado. El nombre de SO debe coincidir exactamente con el que reporta Netskope.")
async def update_os_minimums(payload: OsMinimumsPayload, request: Request, actor_id: str = Depends(require_permission("netskope:admin"))):
    return await save_netskope_baseline(request.app.state.db, "os_minimum_versions", {"minimums": payload.minimums}, _note(payload.note), actor_id)
