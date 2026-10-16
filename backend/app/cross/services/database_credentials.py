"""Resolve a PostgreSQL connection string with a guarded AWS fallback."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import psycopg
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from app.cross.integrations.aws_secrets_manager import (
    SecretRetrievalError,
    get_secret_string,
)

LOGGER = logging.getLogger(__name__)


class DatabaseCredentialError(RuntimeError):
    """A sanitized database credential preflight failure."""


@dataclass(frozen=True)
class DatabaseCredentialResolution:
    database_url: str
    recovered_from_aws: bool


Probe = Callable[[str], None]
SecretFetcher = Callable[[str, str | None], str]


def probe_database(database_url: str) -> None:
    """Validate that the URL can authenticate and execute a minimal query."""
    with psycopg.connect(database_url, connect_timeout=5) as connection:
        connection.execute("SELECT 1")


def _connection_values(database_url: str | None) -> dict[str, str]:
    if not database_url:
        return {}
    try:
        return conninfo_to_dict(database_url)
    except psycopg.Error as exc:
        raise DatabaseCredentialError(
            "DATABASE_URL no tiene un formato PostgreSQL válido"
        ) from exc


def _replace_password(current_url: str | None, password: str) -> str:
    values = _connection_values(current_url)
    if not values:
        raise DatabaseCredentialError(
            "El secreto contiene sólo password y no existe una DATABASE_URL base"
        )
    values["password"] = password
    return make_conninfo(**values)


def database_url_from_password_file(current_url: str | None, password_file: str | None) -> str:
    """Combine passwordless connection metadata with a local secret file."""
    if not password_file:
        return (current_url or "").strip()
    try:
        password = Path(password_file).read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise DatabaseCredentialError("No se pudo leer DATABASE_PASSWORD_FILE") from exc
    if not password:
        raise DatabaseCredentialError("DATABASE_PASSWORD_FILE está vacío")
    return _replace_password(current_url, password)


def _url_from_mapping(payload: Mapping[str, Any], current_url: str | None) -> str:
    explicit_url = payload.get("DATABASE_URL", payload.get("database_url"))
    if isinstance(explicit_url, str) and explicit_url.strip():
        _connection_values(explicit_url.strip())
        return explicit_url.strip()

    password = payload.get("password")
    if not isinstance(password, str) or not password:
        raise DatabaseCredentialError(
            "SecretString no contiene DATABASE_URL ni un campo password válido"
        )

    values = _connection_values(current_url)
    field_mapping = {
        "host": "host",
        "port": "port",
        "username": "user",
        "user": "user",
        "dbname": "dbname",
        "database": "dbname",
    }
    for source, target in field_mapping.items():
        value = payload.get(source)
        if value is not None and str(value).strip():
            values[target] = str(value).strip()
    values["password"] = password

    missing = [name for name in ("host", "user", "dbname") if not values.get(name)]
    if missing:
        raise DatabaseCredentialError(
            "El secreto no aporta los datos de conexión requeridos: " + ", ".join(missing)
        )
    try:
        return make_conninfo(**values)
    except psycopg.Error as exc:
        raise DatabaseCredentialError(
            "Los campos del secreto no forman una conexión PostgreSQL válida"
        ) from exc


def database_url_from_secret(secret_string: str, current_url: str | None) -> str:
    """Build a connection string from supported SecretString shapes.

    Supported values are a URL, a JSON object with ``DATABASE_URL``, an
    RDS-style JSON object, or a password-only value combined with the current
    connection metadata.
    """
    value = secret_string.strip()
    if not value:
        raise DatabaseCredentialError("SecretString está vacío")

    try:
        payload: Any = json.loads(value)
    except json.JSONDecodeError:
        payload = value

    if isinstance(payload, dict):
        return _url_from_mapping(payload, current_url)
    if not isinstance(payload, str) or not payload:
        raise DatabaseCredentialError("SecretString tiene un formato no soportado")

    normalized = payload.strip()
    if normalized.startswith(("postgresql://", "postgres://")):
        _connection_values(normalized)
        return normalized
    return _replace_password(current_url, normalized)


def _is_authentication_failure(exc: psycopg.Error) -> bool:
    """True when PostgreSQL rejected the credential, not some other failure.

    28P01 (invalid_password) is the literal "wrong password" case. RDS/
    PostgreSQL can also reject a stale credential as 28000
    (invalid_authorization_specification), which surfaces to the client as
    "no pg_hba.conf entry for host ..." -- observed against this project's
    RDS instance. Both SQLSTATEs fall under "Class 28 - Invalid
    Authorization Specification", so treat the whole class as a credential
    failure; only that class is worth spending an AWS Secrets Manager call
    on. Some multi-address connection failures expose only the composed
    message, so keep the exact server phrases as a narrow text fallback
    without logging the full exception (it can carry the rejected password
    inline).
    """
    sqlstate = exc.sqlstate or ""
    if sqlstate.startswith("28"):
        return True
    text = str(exc).casefold()
    return "password authentication failed" in text or "no pg_hba.conf entry" in text


def resolve_database_url(
    current_url: str | None,
    secret_id: str | None,
    *,
    region: str | None,
    probe: Probe = probe_database,
    fetch_secret: SecretFetcher = get_secret_string,
) -> DatabaseCredentialResolution:
    """Validate the current URL and fetch AWS only for a credential failure."""
    normalized_url = current_url.strip() if current_url else ""
    normalized_secret_id = secret_id.strip() if secret_id else ""

    if normalized_url:
        try:
            probe(normalized_url)
            return DatabaseCredentialResolution(normalized_url, recovered_from_aws=False)
        except psycopg.Error as exc:
            if not _is_authentication_failure(exc):
                raise DatabaseCredentialError(
                    "La conexión a PostgreSQL falló por una causa que no es de autenticación; no se consultó AWS"
                ) from exc

    if not normalized_secret_id:
        if normalized_url:
            raise DatabaseCredentialError(
                "La contraseña de PostgreSQL fue rechazada y DATABASE_SECRET_ID no está configurado"
            )
        raise DatabaseCredentialError(
            "DATABASE_URL es obligatorio cuando DATABASE_SECRET_ID no está configurado"
        )

    try:
        secret_string = fetch_secret(normalized_secret_id, region)
        resolved_url = database_url_from_secret(secret_string, normalized_url or None)
    except (SecretRetrievalError, DatabaseCredentialError):
        raise
    except Exception as exc:
        raise DatabaseCredentialError(
            "No se pudo interpretar la credencial recuperada desde AWS"
        ) from exc

    try:
        probe(resolved_url)
    except psycopg.Error as exc:
        raise DatabaseCredentialError(
            "La credencial recuperada desde AWS no pudo validarse contra PostgreSQL"
        ) from exc

    return DatabaseCredentialResolution(resolved_url, recovered_from_aws=True)


class DatabaseCredentialProvider:
    """Keeps a live connection pool's conninfo in sync with AWS Secrets Manager.

    ``resolve_database_url`` above only ran once, in the ``run_with_database_secret.py``
    preflight before the process started. If RDS rotates the password while
    the backend is already running, the pool kept retrying with the stale
    value forever: nothing crashed (so systemd's ``Restart=always`` never
    triggered), and nothing ever asked AWS for the new one.

    ``psycopg_pool.AsyncConnectionPool`` accepts a zero-argument callable as
    ``conninfo`` and calls it fresh on every connection attempt, and a
    ``reconnect_failed`` hook fired once it gives up reconnecting with the
    current value. This class is both: instances of it are the callable
    (``__call__``) and expose ``on_reconnect_failed`` for that hook, so a
    rotated credential recovers in place instead of needing a manual restart.
    """

    def __init__(
        self,
        initial_url: str,
        secret_id: str | None,
        *,
        region: str | None,
        probe: Probe = probe_database,
        fetch_secret: SecretFetcher = get_secret_string,
    ) -> None:
        self._current_url = initial_url
        self._secret_id = secret_id
        self._region = region
        self._probe = probe
        self._fetch_secret = fetch_secret
        self._lock = asyncio.Lock()

    def __call__(self) -> str:
        """The pool's ``conninfo`` callable: re-invoked on every new connection."""
        return self._current_url

    async def recover(self) -> bool:
        """Re-run the guarded probe-then-AWS-fetch resolution.

        Safe under concurrent callers: only the first one to acquire the lock
        actually probes/fetches; the rest observe its outcome. Returns
        whether the resolved URL changed. Raises ``DatabaseCredentialError``/
        ``SecretRetrievalError`` (sanitized, never containing the secret) if
        no valid credential could be resolved at all.
        """
        async with self._lock:
            previous_url = self._current_url
            resolution = await asyncio.to_thread(
                resolve_database_url,
                self._current_url,
                self._secret_id,
                region=self._region,
                probe=self._probe,
                fetch_secret=self._fetch_secret,
            )
            self._current_url = resolution.database_url
            return resolution.database_url != previous_url

    async def on_reconnect_failed(self, pool: object) -> None:
        """``psycopg_pool`` ``reconnect_failed`` hook.

        Never raises: this runs inside the pool's own maintenance worker, and
        a network outage unrelated to credentials must not break that worker.
        The pool already logs the underlying failure and keeps retrying on
        its own schedule; this only adds a chance to pick up a rotated
        secret before the next attempt.
        """
        try:
            changed = await self.recover()
        except (DatabaseCredentialError, SecretRetrievalError):
            LOGGER.warning(
                "No se pudo recuperar una credencial de base de datos válida "
                "tras el fallo de reconexión del pool %r",
                pool,
                exc_info=True,
            )
            return
        if changed:
            LOGGER.warning(
                "Credencial de base de datos recuperada desde AWS Secrets Manager "
                "tras un fallo de reconexión del pool %r",
                pool,
            )
