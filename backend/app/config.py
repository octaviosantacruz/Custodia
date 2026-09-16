from __future__ import annotations

import os
from dataclasses import dataclass


MIN_SESSION_SECRET_BYTES = 32
UNSAFE_SESSION_SECRETS = frozenset({
    "change-this-to-a-long-random-value",
    "change-me",
    "changeme",
})


def allowed_web_origins(web_origin: str | None) -> list[str]:
    """Return only origins explicitly configured by the deployment.

    Local development uses WEB_ORIGIN=http://127.0.0.1:5173 from the example
    environment. Keeping localhost implicit here would also trust it in a
    production process whose real WEB_ORIGIN is HTTPS.
    """
    return [web_origin] if web_origin else []


def api_docs_urls(expose_api_docs: bool) -> dict[str, str | None]:
    """PENTEST-010: pulled out as its own pure function so a unit test can
    prove the mapping directly, without needing to reconstruct the FastAPI
    app singleton (app/main.py builds it once at import time from whatever
    settings happen to be in the environment when the test process first
    imports it -- there's no way to exercise the "docs disabled" branch
    against a live app within that same shared process)."""
    if expose_api_docs:
        return {"docs_url": "/docs", "redoc_url": "/redoc", "openapi_url": "/openapi.json"}
    return {"docs_url": None, "redoc_url": None, "openapi_url": None}


@dataclass(frozen=True)
class AppSettings:
    """Validated process-level settings used by application startup."""

    database_url: str
    ingestion_interval_minutes: float
    session_max_age_seconds: int
    session_idle_timeout_seconds: int
    auth_mode: str
    session_secret: str
    session_https_only: bool
    web_origin: str | None
    api_max_body_bytes: int
    expose_api_docs: bool = True

    @classmethod
    def from_environment(cls) -> "AppSettings":
        database_url = os.environ.get("DATABASE_URL", "").strip()
        if not database_url:
            raise RuntimeError("DATABASE_URL es obligatorio")

        interval = float(os.environ.get("INGESTION_INTERVAL_MINUTES", "0"))
        if interval < 0:
            raise RuntimeError("INGESTION_INTERVAL_MINUTES no puede ser negativo")
        # Antes exigía un mínimo de 24 horas. Bajado a 5 minutos para permitir
        # ingesta "casi en tiempo real" sin depender de que un operador
        # dispare la sincronización manualmente cada vez que se necesita ver
        # un Safe/cuenta/PSM nuevo. El único límite real por debajo de esto
        # es externo: cuánta carga tolera la API de CyberArk/Identity/SIA sin
        # rate-limit ni degradación -- no verificado por este repositorio.
        # Probar cualquier valor por debajo de 1440 primero en un ambiente
        # que no sea producción (ver docs/operations/ingestion-frequency.md).
        if 0 < interval < 5:
            raise RuntimeError("La ingesta programada debe ejecutarse como mínimo cada 5 minutos")

        max_age = int(os.environ.get("SESSION_MAX_AGE_SECONDS", "28800"))
        if max_age < 3600:
            raise RuntimeError("SESSION_MAX_AGE_SECONDS debe ser de al menos una hora")
        idle_timeout = int(os.environ.get("SESSION_IDLE_TIMEOUT_SECONDS", "900"))
        if idle_timeout < 300:
            raise RuntimeError("SESSION_IDLE_TIMEOUT_SECONDS debe ser de al menos cinco minutos")
        if idle_timeout >= max_age:
            raise RuntimeError("SESSION_IDLE_TIMEOUT_SECONDS debe ser menor que SESSION_MAX_AGE_SECONDS")

        auth_mode = os.environ.get("AUTH_MODE", "local").strip().lower()
        if auth_mode not in {"local", "oidc", "hybrid"}:
            raise RuntimeError("AUTH_MODE debe ser 'local', 'oidc' o 'hybrid'")
        secret = os.environ.get("SESSION_SECRET", "").strip()
        if auth_mode in {"local", "oidc", "hybrid"} and not secret:
            raise RuntimeError("SESSION_SECRET es obligatorio cuando AUTH_MODE=local, oidc o hybrid")
        if auth_mode in {"local", "oidc", "hybrid"} and (
            len(secret.encode("utf-8")) < MIN_SESSION_SECRET_BYTES
            or secret.casefold() in UNSAFE_SESSION_SECRETS
        ):
            raise RuntimeError(
                "SESSION_SECRET debe tener al menos 32 bytes aleatorios y no puede usar un placeholder conocido"
            )

        api_max_body_bytes = int(os.environ.get("API_MAX_BODY_BYTES", str(8 * 1024 * 1024)))
        if api_max_body_bytes < 64 * 1024 or api_max_body_bytes > 64 * 1024 * 1024:
            raise RuntimeError("API_MAX_BODY_BYTES debe estar entre 65536 y 67108864")

        # PENTEST-010: Swagger/ReDoc/openapi.json expusieron públicamente las
        # 103 operaciones de la API sin requerir sesión. Default `true` para
        # no romper el flujo de desarrollo local existente; el checklist de
        # despliegue (docs/operations/deployment.md) exige poner
        # EXPOSE_API_DOCS=false en cualquier ambiente donde el puerto del
        # backend pueda ser alcanzado directamente sin pasar por el proxy.
        expose_api_docs = os.environ.get("EXPOSE_API_DOCS", "true").strip().lower() == "true"

        return cls(
            database_url=database_url,
            ingestion_interval_minutes=interval,
            session_max_age_seconds=max_age,
            session_idle_timeout_seconds=idle_timeout,
            auth_mode=auth_mode,
            session_secret=secret,
            session_https_only=os.environ.get(
                "SESSION_HTTPS_ONLY",
                "true" if auth_mode in {"oidc", "hybrid"} else "false",
            ).lower() == "true",
            web_origin=os.environ.get("WEB_ORIGIN") or None,
            api_max_body_bytes=api_max_body_bytes,
            expose_api_docs=expose_api_docs,
        )
