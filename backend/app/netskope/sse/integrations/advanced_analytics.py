"""AA query transport; results require a metric-specific allowlist before use."""

from __future__ import annotations

import asyncio
import csv
import io
import json
import math
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

import httpx

from app.netskope.sse.integrations.netskope import NetskopeError, NetskopeSettings
from app.cross.services.secret_values import secret_from_environment


class AdvancedAnalyticsError(NetskopeError):
    """Controlled error with no remote payload or tenant identifiers."""


@dataclass(frozen=True)
class AdvancedAnalyticsSettings:
    base_url: str
    api_token: str = field(repr=False)
    request_timeout_seconds: float = 20

    @classmethod
    def from_environment(cls):
        try:
            token = secret_from_environment("NETSKOPE_API_TOKEN", "NETSKOPE_API_TOKEN_FILE")
        except (OSError, ValueError, RuntimeError):
            raise AdvancedAnalyticsError("AA: credencial no disponible") from None
        base_url = os.getenv("NETSKOPE_URL", "").strip().rstrip("/")
        if not base_url or not token:
            raise AdvancedAnalyticsError("AA: faltan URL o credencial Netskope")
        return cls(base_url, token)


@dataclass(frozen=True)
class AnalyticsResult:
    format: str
    payload: Any


def _identifier(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value):
        raise AdvancedAnalyticsError("AA: identificador inválido")
    return value


class AdvancedAnalyticsClient:
    """Sequential polling per task, bounded duration, no replay of creation.

    This transport does not publish or persist results. Report/widget selection,
    period and public column allowlists belong to the future metric contract.
    """

    MAX_BYTES = 2 * 1024 * 1024

    def __init__(self, settings: NetskopeSettings | AdvancedAnalyticsSettings, http_client: httpx.AsyncClient | None = None):
        parsed = urlparse(settings.base_url)
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
                or parsed.query or parsed.fragment or parsed.path not in ("", "/")):
            raise AdvancedAnalyticsError("AA: base HTTPS inválida")
        self.settings = settings
        self._http = http_client
        self._owns_http = http_client is None
        self._ready_at = 0.0

    async def __aenter__(self):
        if self._http is None:
            self._http = httpx.AsyncClient(follow_redirects=False)
        return self

    async def __aexit__(self, *_args):
        if self._http is not None and self._owns_http:
            await self._http.aclose()
            self._http = None

    async def _request(self, method: str, path: str, deadline: float, params=None) -> tuple[bytes, str]:
        if self._http is None:
            raise AdvancedAnalyticsError("AA: usar el cliente dentro de un context manager")
        delay = self._ready_at - time.monotonic()
        if delay > 0:
            if time.monotonic() + delay >= deadline:
                raise AdvancedAnalyticsError("AA: plazo agotado por rate limit")
            await asyncio.sleep(delay)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise AdvancedAnalyticsError("AA: plazo de consulta agotado")
        try:
            async with self._http.stream(
                method, self.settings.base_url.rstrip("/") + path, params=params,
                headers={"Netskope-API-Token": self.settings.api_token, "Accept": "application/json, text/csv"},
                timeout=min(self.settings.request_timeout_seconds, remaining), follow_redirects=False,
            ) as response:
                # Never retry POST: a lost response may already have created a task.
                if not 200 <= response.status_code < 300:
                    raise AdvancedAnalyticsError(f"AA: HTTP {response.status_code}")
                reset = response.headers.get("ratelimit-reset", "0")
                if response.headers.get("ratelimit-remaining") == "0":
                    try:
                        seconds = float(reset)
                    except ValueError:
                        raise AdvancedAnalyticsError("AA: rate limit inválido") from None
                    if not math.isfinite(seconds) or seconds < 0:
                        raise AdvancedAnalyticsError("AA: rate limit inválido")
                    self._ready_at = time.monotonic() + seconds
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    if time.monotonic() >= deadline:
                        raise AdvancedAnalyticsError("AA: plazo de consulta agotado")
                    body.extend(chunk)
                    if len(body) > self.MAX_BYTES:
                        raise AdvancedAnalyticsError("AA: respuesta excede el límite de tamaño")
                content_type = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
                return bytes(body), content_type
        except httpx.HTTPError:
            raise AdvancedAnalyticsError("AA: error de transporte; consulta no repetida") from None

    @staticmethod
    def _object(body: bytes) -> dict[str, Any]:
        try:
            value = json.loads(body)
        except (ValueError, UnicodeError):
            raise AdvancedAnalyticsError("AA: respuesta JSON inválida") from None
        if not isinstance(value, dict):
            raise AdvancedAnalyticsError("AA: se esperaba un objeto JSON")
        return value

    async def list_catalog(self, kind: str, *, report_id: str | None = None) -> dict[str, Any]:
        """Catalog metadata only; never executes widget queries."""
        if kind not in ("reports", "widgets") or (kind == "reports" and report_id is not None):
            raise AdvancedAnalyticsError("AA: catálogo inválido")
        path = "/api/v2/reporting/aa/" + kind
        if report_id is not None:
            path = f"/api/v2/reporting/aa/reports/{_identifier(report_id)}/widgets"
        body, content_type = await self._request("GET", path, time.monotonic() + 45)
        # Catalog sweeps are sequential and respect the same tenant rate limit.
        self._ready_at = max(self._ready_at, time.monotonic() + 0.25)
        if content_type != "application/json":
            raise AdvancedAnalyticsError("AA: catálogo sin JSON")
        return self._object(body)

    async def query_widget(
        self, report_id: str, widget_id: str, *, limit: int = 500,
        max_polls: int = 12, poll_seconds: float = 2, deadline_seconds: float = 90,
    ) -> AnalyticsResult:
        report_id, widget_id = _identifier(report_id), _identifier(widget_id)
        if (type(limit) is not int or not 1 <= limit <= 10_000
                or type(max_polls) is not int or not 1 <= max_polls <= 30
                or not math.isfinite(poll_seconds) or not 0 < poll_seconds <= 60
                or not math.isfinite(deadline_seconds) or not 0 < deadline_seconds <= 300):
            raise AdvancedAnalyticsError("AA: límites de consulta inválidos")
        deadline = time.monotonic() + deadline_seconds
        body, _ = await self._request(
            "POST", f"/api/v2/reporting/aa/reports/{report_id}/widgets/{widget_id}/async", deadline,
            {"limit": limit, "resultFormat": "json"},
        )
        task_id = _identifier(self._object(body).get("query_task_id"))
        task_path = f"/api/v2/reporting/aa/tasks/{task_id}"
        for _ in range(max_polls):
            # Use the larger of the polling pause and the server's rate limit.
            self._ready_at = max(self._ready_at, time.monotonic() + poll_seconds)
            body, _ = await self._request("GET", task_path + "/status", deadline)
            state = self._object(body).get("status")
            if not isinstance(state, str) or not state:
                raise AdvancedAnalyticsError("AA: estado de tarea inválido")
            if state == "complete":
                body, content_type = await self._request("GET", task_path + "/result", deadline)
                if content_type in ("text/csv", "application/csv"):
                    try:
                        payload = list(csv.reader(io.StringIO(body.decode("utf-8-sig")), strict=True))
                    except (UnicodeError, csv.Error):
                        raise AdvancedAnalyticsError("AA: CSV inválido") from None
                    if payload and any(len(row) != len(payload[0]) for row in payload[1:]):
                        raise AdvancedAnalyticsError("AA: CSV con filas inconsistentes")
                    return AnalyticsResult("csv", payload)
                if content_type == "application/json":
                    try:
                        payload = json.loads(body)
                    except (ValueError, UnicodeError):
                        raise AdvancedAnalyticsError("AA: resultado JSON inválido") from None
                    if not isinstance(payload, (dict, list)):
                        raise AdvancedAnalyticsError("AA: formato de resultado JSON inválido")
                    return AnalyticsResult("json", payload)
                raise AdvancedAnalyticsError("AA: formato de resultado no admitido")
            if state in ("failed", "error", "cancelled"):
                raise AdvancedAnalyticsError("AA: tarea sin resultado exitoso")
        raise AdvancedAnalyticsError("AA: límite de consultas de estado agotado")
