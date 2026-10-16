"""Validated process-level settings used by application startup.

BE-CFG-001 pilot: pydantic-settings owns coercion and validation. Ranges and
the auth-mode enum are declarative (Field/Literal); the rules that carry
business context (ingestion floor, secret strength, cross-field timeout order,
secret-file pointers) stay explicit validators with their own message.
``from_environment`` keeps the RuntimeError contract the startup path and its
tests publish, so a bad configuration still fails before serving traffic.
"""

from __future__ import annotations

import os
from typing import Any, Literal

from pydantic import Field, ValidationError, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.cross.services.database_credentials import DatabaseCredentialError, database_url_from_password_file
from app.cross.services.secret_values import secret_from_environment


MIN_SESSION_SECRET_BYTES = 32
UNSAFE_SESSION_SECRETS = frozenset({
    "change-this-to-a-long-random-value",
    "change-me",
    "changeme",
})


def allowed_web_origins(web_origin: str | None, additional_origins: str | None = None) -> list[str]:
    """Return only origins explicitly configured by the deployment.

    Local development uses an explicit WEB_ORIGIN/WEB_ORIGINS value. Keeping
    localhost implicit here would also trust it in a production process whose
    real WEB_ORIGIN is HTTPS.
    """
    values = [web_origin] if web_origin else []
    values.extend(origin.strip() for origin in (additional_origins or '').split(',') if origin.strip())
    return list(dict.fromkeys(values))


def api_docs_urls(expose_api_docs: bool) -> dict[str, str | None]:
    """PENTEST-010: pulled out as its own pure function so a unit test can
    prove the mapping directly, without needing to reconstruct the FastAPI
    app singleton (app/main.py builds it once at import time from whatever
    settings happen to be in the environment when the test process first
    imports it -- there's no way to exercise the "docs disabled" branch
    against a live app within that same shared process)."""
    if expose_api_docs:
        return {"docs_url": "/docs", "openapi_url": "/openapi.json"}
    return {"docs_url": None, "openapi_url": None}


def api_docs_enabled_for_session(expose_api_docs: bool, authenticated: bool) -> bool:
    """DOCS-PORTAL-001: the authenticated status payload carries this signal so
    the product guide links /docs only when the deployment exposes it. It is a
    read-only signal: /docs and /openapi.json stay governed exclusively by
    EXPOSE_API_DOCS (api_docs_urls above), and the frontend cannot enable them.
    Unauthenticated requests always get False."""
    return bool(expose_api_docs) and bool(authenticated)


class AppSettings(BaseSettings):
    """Validated process-level settings used by application startup."""

    model_config = SettingsConfigDict(env_file=None, extra="forbid", frozen=True, validate_default=True)

    database_url: str = ""
    ingestion_interval_minutes: float = 0
    # SYNC-POLICY-001: per-source cadence override, e.g. {"netskope": 30}; the
    # key must be a registered source (checked at startup). 0 disables a source.
    sync_source_intervals: dict[str, float] = Field(default_factory=dict)
    # The pool has eight connections and each active source holds one for its
    # advisory lock, so the budget stays well below the pool size.
    sync_max_concurrent_sources: int = Field(default=3, ge=1, le=5)
    session_max_age_seconds: int = Field(default=28800, ge=3600)
    session_idle_timeout_seconds: int = Field(default=900, ge=300)
    auth_mode: Literal["local", "oidc", "hybrid"] = "local"
    session_secret: str = ""
    session_https_only: bool = False
    web_origin: str | None = None
    api_max_body_bytes: int = Field(default=8 * 1024 * 1024, ge=64 * 1024, le=64 * 1024 * 1024)
    # PENTEST-010: Swagger/ReDoc/openapi.json expusieron públicamente las 103
    # operaciones de la API sin requerir sesión. Default `true` para no romper
    # el flujo de desarrollo local existente; el checklist de despliegue
    # (docs/operations/deployment.md) exige poner EXPOSE_API_DOCS=false en
    # cualquier ambiente donde el puerto del backend pueda ser alcanzado
    # directamente sin pasar por el proxy.
    expose_api_docs: bool = True
    database_secret_id: str | None = None
    database_secret_region: str | None = None

    @model_validator(mode="before")
    @classmethod
    def _session_https_default(cls, data: Any) -> Any:
        # SESSION_HTTPS_ONLY defaults by auth mode, so it cannot be a plain
        # field default; an explicit value (environment or constructor) wins.
        if isinstance(data, dict) and "session_https_only" not in data:
            mode = str(data.get("auth_mode", "local")).strip().lower()
            data["session_https_only"] = "true" if mode in {"oidc", "hybrid"} else "false"
        return data

    @field_validator("database_url", mode="before")
    @classmethod
    def _resolve_database_password_file(cls, value: Any) -> Any:
        url = str(value or "").strip()
        if not url:
            # The required-field validator reports the missing URL first, as
            # before, without touching a configured password file.
            return url
        try:
            return database_url_from_password_file(url, os.environ.get("DATABASE_PASSWORD_FILE", "").strip())
        except DatabaseCredentialError as exc:
            raise ValueError(str(exc)) from exc

    @field_validator("database_url")
    @classmethod
    def _require_database_url(cls, value: str) -> str:
        if not value:
            raise ValueError("DATABASE_URL es obligatorio")
        return value

    @field_validator("ingestion_interval_minutes")
    @classmethod
    def _validate_ingestion_interval(cls, value: float) -> float:
        if value < 0:
            raise ValueError("INGESTION_INTERVAL_MINUTES no puede ser negativo")
        # Antes exigía un mínimo de 24 horas. Bajado a 5 minutos para permitir
        # ingesta "casi en tiempo real" sin depender de que un operador
        # dispare la sincronización manualmente cada vez que se necesita ver
        # un Safe/cuenta/PSM nuevo. El único límite real por debajo de esto
        # es externo: cuánta carga tolera la API de CyberArk/Identity/SIA sin
        # rate-limit ni degradación -- no verificado por este repositorio.
        # Probar cualquier valor por debajo de 1440 primero en un ambiente
        # que no sea producción (ver docs/operations/ingestion-frequency.md).
        if 0 < value < 5:
            raise ValueError("La ingesta programada debe ejecutarse como mínimo cada 5 minutos")
        return value

    @field_validator("sync_source_intervals")
    @classmethod
    def _validate_source_intervals(cls, value: dict[str, float]) -> dict[str, float]:
        for source, minutes in value.items():
            if minutes < 0 or 0 < minutes < 5:
                raise ValueError(f"SYNC_SOURCE_INTERVALS[{source}] debe ser 0 o al menos 5 minutos")
        return value

    @field_validator("auth_mode", mode="before")
    @classmethod
    def _normalize_auth_mode(cls, value: Any) -> str:
        return str(value).strip().lower()

    @field_validator("session_secret", mode="before")
    @classmethod
    def _resolve_session_secret_file(cls, value: Any) -> Any:
        # SESSION_SECRET_FILE is an auxiliary pointer, not a field; the shared
        # helper keeps the file-over-inline precedence.
        if not value or os.environ.get("SESSION_SECRET_FILE", "").strip():
            return secret_from_environment("SESSION_SECRET", "SESSION_SECRET_FILE")
        return value

    @field_validator("session_secret")
    @classmethod
    def _validate_session_secret(cls, value: str) -> str:
        if not value:
            raise ValueError("SESSION_SECRET es obligatorio cuando AUTH_MODE=local, oidc o hybrid")
        if len(value.encode("utf-8")) < MIN_SESSION_SECRET_BYTES or value.casefold() in UNSAFE_SESSION_SECRETS:
            raise ValueError(
                "SESSION_SECRET debe tener al menos 32 bytes aleatorios y no puede usar un placeholder conocido"
            )
        return value

    @field_validator("session_https_only", "expose_api_docs", mode="before")
    @classmethod
    def _parse_boolean(cls, value: Any) -> bool:
        # The deployment's boolean contract: only 'true' (case-insensitive) is
        # true, so SESSION_HTTPS_ONLY=1 keeps meaning false exactly as before.
        return str(value).strip().lower() == "true"

    @field_validator("web_origin", mode="before")
    @classmethod
    def _empty_web_origin(cls, value: Any) -> Any:
        return value or None

    @field_validator("database_secret_id", "database_secret_region", mode="before")
    @classmethod
    def _strip_optional_identifier(cls, value: Any) -> Any:
        if value is None:
            return None
        return str(value).strip() or None

    @model_validator(mode="after")
    def _validate_session_timeouts(self) -> "AppSettings":
        if self.session_idle_timeout_seconds >= self.session_max_age_seconds:
            raise ValueError("SESSION_IDLE_TIMEOUT_SECONDS debe ser menor que SESSION_MAX_AGE_SECONDS")
        return self

    @classmethod
    def from_environment(cls) -> "AppSettings":
        try:
            return cls()
        except ValidationError as exc:
            error = exc.errors()[0]
            message = str(error["msg"]).removeprefix("Value error, ")
            location = ".".join(str(part) for part in error["loc"]).upper()
            # Custom validators name their own variable; only pydantic's native
            # coercion errors need the field name prepended.
            raise RuntimeError(message if error["type"] == "value_error" else f"{location}: {message}") from exc
