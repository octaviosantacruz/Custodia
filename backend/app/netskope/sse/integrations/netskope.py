"""Netskope REST API v2 client for the verified CMDB inventory contract."""

from __future__ import annotations

import asyncio
import math
import os
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode, urljoin, urlparse

import httpx

from app.cross.services.retry_backoff import retry_delay
from app.cross.services.secret_values import secret_from_environment
from app.netskope.sse.services.netskope_experience import (
    map_adem_device_details,
    map_adem_device_scores,
    map_adem_devices,
    map_adem_user_score,
)


class NetskopeError(RuntimeError):
    """A controlled Netskope client error."""


class NetskopeNotConfigured(NetskopeError):
    """Raised when the verified Netskope contract is not configured."""


ALERT_AGGREGATE_DIMENSIONS = (
    "alert_type",
    "policy",
    "severity",
    "action",
    "app",
    "access_method",
)

# NSK-DLP-001: the only approved route for minimal DLP incidents. Any other
# configured value is ignored (never called) instead of being followed.
DLP_INCIDENT_PATH = "/api/v2/events/dataexport/events/incident"
DEM_SITES_PATH = "/api/v2/dem/config/sites"
GROUPS_PATH = "/api/v2/users/getgroups"
# NSK-POLICY-002: Real-time Protection policy groups (read-only GET). Despite its `npa` segment, this route returns the
# console's policy groups (Header Policies, Default, Footer Policies, ...). Its rules are NOT here: `policy/npa/rules`
# only holds Private Access rules.
POLICY_GROUPS_PATH = "/api/v2/policy/npa/policygroups"
# NSK-RBAC-001: administrators and roles (read-only GETs). One switch approves the family: the role listing is the
# anchor; role detail, the administrator SCIM listing and the page mapping are derived from it. The listing silently
# truncates at 25 rows unless `limit` is sent, and the SCIM listing pages with startIndex/count.
RBAC_ROLES_PATH = "/api/v2/rbac/roles"
RBAC_ADMINS_PATH = "/api/v2/platform/administration/scim/Users"
RBAC_PAGEMAPPING_PATH = "/api/v2/rbac/apigroups/pagemapping"
RBAC_PAGE_SIZE = 100
RBAC_MAX_ROLES = 500
RBAC_MAX_ADMINS = 2000
ADEM_POPLIST_PATH = "/api/v2/adem/poplist"
# NSK-UBA-002: the ranked list (Poor/Moderate are complete; Good is capped at
# 1000 rows by the tenant) and the batch history used only to read an earlier score.
UCI_ACTIVE_PATH = "/api/v2/incidents/users/getactiveuci"
UCI_BATCH_PATH = "/api/v2/incidents/uba/getuci"
ANOMALIES_PATH = "/api/v2/incidents/users/getanomalies"
ANOMALIES_TIMEFRAME_DAYS = 30
ANOMALIES_LIMIT = 1000
ADEM_ENTITIES_PATH = "/api/v2/adem/users/getentities"
UCI_RATINGS = ("Poor", "Moderate")
UCI_BATCH_SIZE = 250


def netskope_alerts_configured() -> bool:
    """Report whether the optional, approved alert aggregate path is enabled."""
    return bool(os.getenv("NETSKOPE_ALERT_PATH", "").strip())


def netskope_dlp_alert_export_configured() -> bool:
    """Report the raw DLP export capability without treating it as aggregates."""
    return bool(os.getenv("NETSKOPE_DLP_ALERTS_PATH", "").strip())


def netskope_dlp_incidents_configured() -> bool:
    """Report whether the approved minimal-incident capture path is enabled."""
    return os.getenv("NETSKOPE_DLP_INCIDENTS_PATH", "").strip() == DLP_INCIDENT_PATH


def netskope_dem_sites_configured() -> bool:
    return os.getenv("NETSKOPE_DEM_SITES_PATH", "").strip() == DEM_SITES_PATH


def netskope_uci_configured() -> bool:
    """NSK-UBA-002: the UCI task runs only with the approved ranked route."""
    return os.getenv("NETSKOPE_UCI_PATH", "").strip() == UCI_ACTIVE_PATH


def netskope_policy_groups_configured() -> bool:
    """NSK-POLICY-002: the policy-group listing runs only with the approved route."""
    return os.getenv("NETSKOPE_POLICY_GROUPS_PATH", "").strip() == POLICY_GROUPS_PATH


def netskope_rbac_configured() -> bool:
    """NSK-RBAC-001: the administrator and role inventory runs only with the approved route."""
    return os.getenv("NETSKOPE_RBAC_PATH", "").strip() == RBAC_ROLES_PATH


def netskope_groups_configured() -> bool:
    """NSK-GRP-001: the group inventory runs only with the approved route."""
    return os.getenv("NETSKOPE_GROUPS_PATH", "").strip() == GROUPS_PATH


@dataclass(frozen=True)
class NetskopeSettings:
    base_url: str
    api_token: str
    device_status_path: str
    users_path: str
    user_counts_path: str
    alert_path: str = ""
    dlp_incidents_path: str = ""
    dem_sites_path: str = ""
    groups_path: str = ""
    policy_groups_path: str = ""
    rbac_path: str = ""
    uci_path: str = ""
    request_timeout_seconds: float = 60.0
    max_retries: int = 5
    users_page_size: int = 1000
    devices_page_size: int = 10000
    page_delay_seconds: float = 0.25

    @classmethod
    def from_environment(cls) -> "NetskopeSettings":
        required = {
            "NETSKOPE_URL": os.getenv("NETSKOPE_URL", "").strip(),
            "NETSKOPE_DEVICE_STATUS_PATH": os.getenv("NETSKOPE_DEVICE_STATUS_PATH", "").strip(),
            "NETSKOPE_USERS_PATH": os.getenv("NETSKOPE_USERS_PATH", "").strip(),
            "NETSKOPE_USER_COUNTS_PATH": os.getenv("NETSKOPE_USER_COUNTS_PATH", "").strip(),
        }
        missing = [name for name, value in required.items() if not value]
        token = secret_from_environment("NETSKOPE_API_TOKEN", "NETSKOPE_API_TOKEN_FILE")
        if not token:
            missing.append("NETSKOPE_API_TOKEN o NETSKOPE_API_TOKEN_FILE")
        if missing:
            raise NetskopeNotConfigured("Faltan variables del contrato Netskope: " + ", ".join(missing))
        dem_sites_path = os.getenv("NETSKOPE_DEM_SITES_PATH", "").strip()
        if dem_sites_path and dem_sites_path != DEM_SITES_PATH:
            raise NetskopeNotConfigured("NETSKOPE_DEM_SITES_PATH debe usar la ruta DEM aprobada")
        groups_path = os.getenv("NETSKOPE_GROUPS_PATH", "").strip()
        if groups_path and groups_path != GROUPS_PATH:
            raise NetskopeNotConfigured("NETSKOPE_GROUPS_PATH debe usar la ruta de grupos aprobada")
        policy_groups_path = os.getenv("NETSKOPE_POLICY_GROUPS_PATH", "").strip()
        if policy_groups_path and policy_groups_path != POLICY_GROUPS_PATH:
            raise NetskopeNotConfigured("NETSKOPE_POLICY_GROUPS_PATH debe usar la ruta de grupos de políticas aprobada")
        rbac_path = os.getenv("NETSKOPE_RBAC_PATH", "").strip()
        if rbac_path and rbac_path != RBAC_ROLES_PATH:
            raise NetskopeNotConfigured("NETSKOPE_RBAC_PATH debe usar la ruta de roles aprobada")
        uci_path = os.getenv("NETSKOPE_UCI_PATH", "").strip()
        if uci_path and uci_path != UCI_ACTIVE_PATH:
            raise NetskopeNotConfigured("NETSKOPE_UCI_PATH debe usar la ruta UCI aprobada")
        return cls(
            base_url=required["NETSKOPE_URL"].rstrip("/"),
            api_token=token,
            device_status_path=required["NETSKOPE_DEVICE_STATUS_PATH"],
            users_path=required["NETSKOPE_USERS_PATH"],
            user_counts_path=required["NETSKOPE_USER_COUNTS_PATH"],
            alert_path=os.getenv("NETSKOPE_ALERT_PATH", "").strip(),
            # Only the approved incident route is ever called; any other value
            # stays inert so a typo cannot point the client at a raw export
            # (content, alerts, quarantine) with a broader payload.
            dlp_incidents_path=os.getenv("NETSKOPE_DLP_INCIDENTS_PATH", "").strip(),
            dem_sites_path=dem_sites_path,
            groups_path=groups_path,
            policy_groups_path=policy_groups_path,
            rbac_path=rbac_path,
            uci_path=uci_path,
        )


class NetskopeClient:
    def __init__(self, settings: NetskopeSettings, http_client: httpx.AsyncClient | None = None):
        parsed = urlparse(settings.base_url)
        if parsed.scheme != "https" or not parsed.netloc:
            raise NetskopeNotConfigured("NETSKOPE_URL debe ser una URL HTTPS válida")
        self.settings = settings
        self._http = http_client
        self._owns_http = http_client is None
        self.request_count = 0
        self.retry_count = 0
        self._iterator_ready_at: dict[str, float] = {}

    async def __aenter__(self) -> "NetskopeClient":
        if self._http is None:
            self._http = httpx.AsyncClient(timeout=self.settings.request_timeout_seconds)
        return self

    async def __aexit__(self, exc_type, exc_value, traceback) -> None:
        if self._http is not None and self._owns_http:
            await self._http.aclose()
            self._http = None

    def _url_for(self, path: str) -> str:
        base = urlparse(self.settings.base_url)
        if path.startswith(("http://", "https://")):
            parsed = urlparse(path)
            if parsed.scheme != "https" or parsed.netloc != base.netloc:
                raise NetskopeError("La URL de Netskope debe permanecer en el host HTTPS configurado")
            return path
        url = urljoin(self.settings.base_url + "/", path.lstrip("/"))
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.netloc != base.netloc:
            raise NetskopeError("URL de Netskope fuera del host HTTPS configurado")
        return url

    async def _request_json(self, method: str, path: str, *, body: dict[str, Any] | None = None, retry_path: str | None = None) -> Any:
        if self._http is None:
            raise NetskopeError("NetskopeClient debe usarse dentro de un context manager")
        headers = {"Netskope-API-Token": self.settings.api_token, "Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        endpoint = urlparse(self._url_for(path)).path
        last_retryable_status: int | None = None
        for attempt in range(self.settings.max_retries):
            if retry_path is not None:
                remaining = self._iterator_ready_at.get(endpoint, 0) - time.monotonic()
                if remaining > 0:
                    await asyncio.sleep(remaining)
            self.request_count += 1
            self.retry_count += int(attempt > 0)
            try:
                response = await self._http.request(method, self._url_for(path), headers=headers, json=body)
            except httpx.HTTPError as exc:
                if attempt + 1 >= self.settings.max_retries:
                    raise NetskopeError(f"Error de red en Netskope: {exc}") from exc
                if retry_path is not None:
                    path = retry_path
                await asyncio.sleep(retry_delay(attempt, cap=60))
                continue
            # 409 "Concurrency conflict, retry later": Netskope still has a
            # request in flight for this tenant/cursor. Transient, like a 5xx.
            if response.status_code in (409, 429) or response.status_code >= 500:
                last_retryable_status = response.status_code
                if attempt + 1 >= self.settings.max_retries:
                    break
                retry_after = response.headers.get("retry-after")
                delay: float | None = None
                if retry_after:
                    try:
                        delay = max(0.0, float(retry_after))
                    except ValueError:
                        delay = None
                if delay is None:
                    reset = response.headers.get("x-ratelimit-reset") or response.headers.get("ratelimit-reset")
                    if reset:
                        try:
                            reset_value = float(reset)
                            delay = max(0.0, reset_value - time.time()) if reset_value > time.time() else max(0.0, reset_value)
                        except ValueError:
                            delay = None
                if retry_path is not None and response.status_code != 429:
                    path = retry_path
                    if delay is None:
                        delay = 5
                retry_after_seconds = delay
                if retry_path is None and delay is not None:
                    retry_after_seconds = min(delay, 60)
                await asyncio.sleep(retry_delay(attempt, cap=60, retry_after=retry_after_seconds))
                continue
            if response.is_error:
                raise NetskopeError(f"Netskope respondió HTTP {response.status_code}: {response.text[:400]}")
            try:
                payload = response.json()
            except ValueError as exc:
                if retry_path is not None and attempt + 1 < self.settings.max_retries:
                    path = retry_path
                    await asyncio.sleep(retry_delay(attempt, cap=60))
                    continue
                raise NetskopeError("Netskope devolvió JSON inválido") from exc
            # Some tenant throttling responses have been observed as HTTP 200
            # with only a control `message`, rather than a 429. Retry those
            # responses before treating them as a broken endpoint shape.
            if isinstance(payload, dict) and "message" in payload and not any(
                key in payload for key in ("data", "result", "counts", "status")
            ):
                if attempt + 1 >= self.settings.max_retries:
                    raise NetskopeError("Netskope devolvió una respuesta de control sin datos")
                if retry_path is not None:
                    path = retry_path
                await asyncio.sleep(retry_delay(attempt, cap=60))
                continue
            if retry_path is not None:
                try:
                    remaining = float(response.headers.get("ratelimit-remaining", "1"))
                    reset = float(response.headers.get("ratelimit-reset", "0"))
                except ValueError:
                    remaining, reset = 1, 0
                if remaining <= 0 and math.isfinite(reset) and reset > 0:
                    self._iterator_ready_at[endpoint] = time.monotonic() + reset
            return payload
        if last_retryable_status is not None:
            raise NetskopeError(
                f"Netskope respondió HTTP {last_retryable_status} después de agotar "
                f"{self.settings.max_retries} intentos"
            )
        raise NetskopeError("No se pudo completar la llamada a Netskope")

    async def get_user_counts(self) -> dict[str, Any]:
        payload = await self._request_json("GET", self.settings.user_counts_path)
        if not isinstance(payload, dict):
            raise NetskopeError("Netskope devolvió un objeto inesperado para users/counts")
        return payload

    async def get_alert_aggregates(
        self,
        starttime: int,
        endtime: int,
        dimension: str | None = None,
    ) -> list[dict[str, Any]]:
        """Return count-only alert aggregates for a bounded time window.

        Netskope's datasearch endpoint returns event rows by default. This
        method always requests ``count(id)`` and an optional allowlisted
        dimension, so callers cannot accidentally ingest users, IPs, URLs or
        forensic event payloads as part of the alert feature.
        """
        if not self.settings.alert_path:
            raise NetskopeNotConfigured("NETSKOPE_ALERT_PATH no está configurado")
        if starttime < 0 or endtime < starttime:
            raise NetskopeError("La ventana temporal de alertas Netskope no es válida")
        if dimension is not None and dimension not in ALERT_AGGREGATE_DIMENSIONS:
            raise NetskopeError(f"Dimensión de alertas Netskope no soportada: {dimension}")
        params: dict[str, str] = {
            "starttime": str(starttime),
            "endtime": str(endtime),
            "fields": "count_total:count(id)",
        }
        if dimension:
            params["groupbys"] = dimension
        separator = "&" if "?" in self.settings.alert_path else "?"
        payload = await self._request_json(
            "GET",
            f"{self.settings.alert_path}{separator}{urlencode(params)}",
        )
        if not isinstance(payload, dict) or not isinstance(payload.get("result"), list):
            raise NetskopeError("La respuesta agregada de alertas no contiene result[]")
        aggregates: list[dict[str, Any]] = []
        for item in payload["result"]:
            if not isinstance(item, dict) or not isinstance(item.get("count_total"), int):
                raise NetskopeError("La respuesta agregada de alertas contiene una fila inválida")
            raw_key = item.get("_id") if dimension else None
            # Datasearch tenants return group keys in either of two shapes:
            # a scalar ``_id`` or an object keyed by the requested groupby.
            # Only unwrap the exact allowlisted dimension so an unexpected
            # compound group cannot leak additional event attributes.
            key = raw_key
            if dimension and isinstance(raw_key, dict):
                key = raw_key.get(dimension) if set(raw_key) == {dimension} else None
            if dimension and not isinstance(key, (str, int, float)):
                raise NetskopeError("La respuesta agregada de alertas no contiene _id válido")
            aggregates.append({"key": key, "count": item["count_total"]})
        return aggregates

    async def get_dlp_incident_page(self, operation: str, index: str) -> Any:
        """Fetch one page of the approved minimal DLP incident iterator.

        NSK-DLP-001: only ``DLP_INCIDENT_PATH`` is accepted. The caller owns
        the iterator index and must serialize requests for a given index; the
        capture service applies the public field allowlist to the result.
        """
        if self.settings.dlp_incidents_path != DLP_INCIDENT_PATH:
            raise NetskopeNotConfigured("La ruta de incidentes DLP no está aprobada")
        if not operation.strip() or not index.strip():
            raise NetskopeError("El iterator de incidentes DLP requiere operation e index")
        separator = "&" if "?" in self.settings.dlp_incidents_path else "?"
        query = urlencode({"operation": operation.strip(), "index": index.strip()})
        resend_query = urlencode({"operation": "resend", "index": index.strip()})
        payload = await self._request_json(
            "GET", f"{self.settings.dlp_incidents_path}{separator}{query}",
            retry_path=f"{self.settings.dlp_incidents_path}{separator}{resend_query}",
        )
        if (
            not isinstance(payload, dict)
            or not isinstance(payload.get("result"), list)
            or any(not isinstance(row, dict) for row in payload["result"])
            or payload.get("ok", 1) != 1
        ):
            raise NetskopeError("La página de incidentes DLP no cumple el contrato")
        return payload

    async def get_users(self) -> list[dict[str, Any]]:
        users: list[dict[str, Any]] = []
        offset = 0
        total: int | None = None
        while True:
            if total is not None and offset >= total:
                if len(users) < total:
                    raise NetskopeError(
                        f"Netskope agotó offsets en {offset}, pero sólo se acumularon "
                        f"{len(users)} de {total} usuarios"
                    )
                return users[:total]
            if users:
                await asyncio.sleep(self.settings.page_delay_seconds)
            payload = await self._request_json(
                "POST",
                self.settings.users_path,
                body={"query": {"paging": {"offset": offset, "limit": self.settings.users_page_size}, "projection": [
                    # accounts[] carries active/deleted/provisioner per account (the console's user and account
                    # counts) and parentGroups; without it the tenant returns a reduced account object.
                    "id", "givenName", "familyName", "emails", "accounts",
                ]}},
            )
            if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
                keys = sorted(payload.keys()) if isinstance(payload, dict) else []
                raise NetskopeError(f"La respuesta de usuarios no contiene data[] en offset={offset}; claves={keys}")
            counts = payload.get("counts") if isinstance(payload.get("counts"), dict) else {}
            page = payload["data"]
            if not all(isinstance(item, dict) for item in page):
                raise NetskopeError("La respuesta de usuarios contiene elementos inválidos")
            reported_offset = counts.get("offset")
            if reported_offset != offset:
                raise NetskopeError(f"Netskope devolvió offset={reported_offset!r}, esperado {offset}")
            if isinstance(counts.get("totalResults"), int):
                page_total = counts["totalResults"]
                if total is not None and page_total != total:
                    raise NetskopeError(
                        f"Netskope reportó totalResults inconsistente ({total} luego {page_total})"
                    )
                total = page_total
            users.extend(page)
            if total is not None and len(users) >= total:
                return users[:total]
            if not page:
                if total is not None and len(users) < total:
                    raise NetskopeError(
                        f"Netskope reportó totalResults={total} pero devolvió una página vacía "
                        f"tras {len(users)} usuarios"
                    )
                return users
            # This tenant can return a short page before the end while still
            # reporting the nominal page size in counts.itemsPerPage. Its
            # next valid cursor is the current offset plus the actual number
            # returned (e.g. 1700 -> 1799), so advancing by the nominal size
            # would skip records.
            offset += len(page)
            if len(users) > 100000:
                raise NetskopeError("Netskope superó el límite de seguridad de paginación de usuarios")

    async def get_groups(self) -> list[dict[str, Any]]:
        """NSK-GRP-001: read-only, completeness-checked group listing (POST query, no mutation).

        ``counts.totalResults`` is required: without it a short read could not
        be told apart from a complete one, and a partial list must never reach
        reconciliation (it would retire real groups).
        """
        if self.settings.groups_path != GROUPS_PATH:
            raise NetskopeNotConfigured("La ruta de grupos Netskope no está aprobada")
        groups: list[dict[str, Any]] = []
        offset = 0
        total: int | None = None
        while total is None or len(groups) < total:
            if groups:
                await asyncio.sleep(self.settings.page_delay_seconds)
            payload = await self._request_json(
                "POST", GROUPS_PATH,
                body={"query": {"paging": {"offset": offset, "limit": self.settings.users_page_size}}},
            )
            if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
                raise NetskopeError(f"La respuesta de grupos no contiene data[] en offset={offset}")
            counts = payload.get("counts") if isinstance(payload.get("counts"), dict) else {}
            page = payload["data"]
            if not all(isinstance(item, dict) for item in page):
                raise NetskopeError("La respuesta de grupos contiene elementos inválidos")
            if counts.get("offset") != offset:
                raise NetskopeError(f"Netskope devolvió offset={counts.get('offset')!r} de grupos, esperado {offset}")
            reported = counts.get("totalResults")
            if isinstance(reported, bool) or not isinstance(reported, int) or reported < 0:
                raise NetskopeError("Netskope no informó totalResults de grupos")
            if total is not None and reported != total:
                raise NetskopeError(f"Netskope reportó totalResults de grupos inconsistente ({total} luego {reported})")
            total = reported
            if not page and len(groups) < total:
                raise NetskopeError(f"Netskope reportó {total} grupos pero devolvió una página vacía tras {len(groups)}")
            groups.extend(page)
            offset += len(page)
            if len(groups) > 100000:
                raise NetskopeError("Netskope superó el límite de seguridad de paginación de grupos")
        return groups[:total]

    async def get_ranked_uci(self) -> list[dict[str, Any]]:
        """NSK-UBA-002: active users rated Poor or Moderate (read-only POST query).

        Each rating must come back complete (`totalCount` equals the rows): a
        truncated list would silently drop users from the replacement, so it
        raises instead.
        """
        if self.settings.uci_path != UCI_ACTIVE_PATH:
            raise NetskopeNotConfigured("La ruta UCI de Netskope no está aprobada")
        rows: list[dict[str, Any]] = []
        for index, rating in enumerate(UCI_RATINGS):
            if index:
                await asyncio.sleep(self.settings.page_delay_seconds)
            payload = await self._request_json("POST", UCI_ACTIVE_PATH, body={"ratingRank": rating})
            results = payload.get("results") if isinstance(payload, dict) else None
            total = payload.get("totalCount") if isinstance(payload, dict) else None
            if not isinstance(results, list) or isinstance(total, bool) or not isinstance(total, int):
                raise NetskopeError(f"La respuesta UCI {rating} no contiene results[] y totalCount")
            if len(results) != total:
                raise NetskopeError(f"Netskope devolvió {len(results)} de {total} usuarios UCI {rating}")
            for item in results:
                if not isinstance(item, dict):
                    raise NetskopeError("La respuesta UCI contiene elementos inválidos")
                rows.append({**item, "rating": rating})
        return rows

    async def get_uci_history(self, users: list[str], from_ms: int, to_ms: int) -> dict[str, list[dict[str, Any]]]:
        """NSK-UBA-002: UCI points per user in the window, batched (read-only POST query)."""
        history: dict[str, list[dict[str, Any]]] = {}
        for start in range(0, len(users), UCI_BATCH_SIZE):
            if start:
                await asyncio.sleep(self.settings.page_delay_seconds)
            batch = users[start:start + UCI_BATCH_SIZE]
            payload = await self._request_json(
                "POST", UCI_BATCH_PATH, body={"users": batch, "fromTime": from_ms, "toTime": to_ms},
            )
            entries = payload.get("usersUci") if isinstance(payload, dict) else None
            if not isinstance(entries, list):
                raise NetskopeError("La respuesta de historial UCI no contiene usersUci[]")
            for entry in entries:
                if not isinstance(entry, dict) or not isinstance(entry.get("userId"), str) or not isinstance(entry.get("confidences"), list):
                    raise NetskopeError("La respuesta de historial UCI contiene elementos inválidos")
                history[entry["userId"].strip().lower()] = [
                    point for point in entry["confidences"] if isinstance(point, dict)
                ]
        return history

    async def get_user_anomalies(self, user: str) -> tuple[list[dict[str, Any]], int]:
        """NSK-EXP-UEBA-001: one user's anomalies of the last 30 days, at most 1000 rows (read-only POST query)."""
        if not user.strip() or len(user) > 320:
            raise NetskopeError("Usuario UEBA inválido")
        payload = await self._request_json(
            "POST", ANOMALIES_PATH, body={"users": [user], "timeframe": ANOMALIES_TIMEFRAME_DAYS, "limit": ANOMALIES_LIMIT},
        )
        results = payload.get("results") if isinstance(payload, dict) else None
        total = payload.get("totalCount") if isinstance(payload, dict) else None
        if not isinstance(results, list) or len(results) > ANOMALIES_LIMIT or isinstance(total, bool) or not isinstance(total, int) or total < len(results):
            raise NetskopeError("La respuesta de anomalías no contiene results[] y totalCount válidos")
        if not all(isinstance(item, dict) for item in results):
            raise NetskopeError("La respuesta de anomalías contiene elementos inválidos")
        return results, total

    async def get_adem_worst_users(self, starttime: int, endtime: int) -> list[dict[str, Any]]:
        """NSK-EXP-UEBA-001: the tenant's lowest ADEM scores. Netskope ignores offset and caps this at 100 users."""
        if starttime < 0 or endtime <= starttime or endtime - starttime > 48 * 3600:
            raise NetskopeError("La ventana ADEM debe ser de hasta 48 horas")
        payload = await self._request_json("POST", ADEM_ENTITIES_PATH, body={"starttime": starttime, "endtime": endtime, "limit": 100})
        users = payload.get("users") if isinstance(payload, dict) else None
        if not isinstance(users, list) or len(users) > 100 or not all(isinstance(item, dict) for item in users):
            raise NetskopeError("ADEM getentities no devolvió users[] válido")
        return [{"email": item.get("user"), "exp_score": item.get("expScore")} for item in users]

    async def get_devices(self) -> list[dict[str, Any]]:
        devices: list[dict[str, Any]] = []
        offset = 0
        while True:
            if devices:
                await asyncio.sleep(self.settings.page_delay_seconds)
            query = urlencode({"offset": offset, "limit": self.settings.devices_page_size})
            path = f"{self.settings.device_status_path}{'&' if '?' in self.settings.device_status_path else '?'}{query}"
            payload = await self._request_json("GET", path)
            if not isinstance(payload, dict) or not isinstance(payload.get("result"), list):
                raise NetskopeError("La respuesta de dispositivos no contiene result[]")
            page = payload["result"]
            if not all(isinstance(item, dict) for item in page):
                raise NetskopeError("La respuesta de dispositivos contiene elementos inválidos")
            devices.extend(page)
            status = payload.get("status") if isinstance(payload.get("status"), dict) else {}
            reported = status.get("count")
            if isinstance(reported, int) and reported < len(page):
                raise NetskopeError("Netskope reportó un count de dispositivos inconsistente")
            if len(page) < self.settings.devices_page_size:
                return devices
            offset += len(page)
            if len(devices) > 100000:
                raise NetskopeError("Netskope superó el límite de seguridad de paginación de dispositivos")

    async def get_dem_sites(self) -> list[dict[str, Any]]:
        """Read the approved, unpaginated DEM site collection without following links."""
        if self.settings.dem_sites_path != DEM_SITES_PATH:
            raise NetskopeNotConfigured("La ruta de sitios DEM no está aprobada")
        payload = await self._request_json("GET", DEM_SITES_PATH)
        if not isinstance(payload, list) or not all(isinstance(item, dict) for item in payload):
            raise NetskopeError("Netskope DEM no devolvió un array de sites válido")
        if len(payload) > 10000:
            raise NetskopeError("Netskope DEM superó el límite de seguridad de sites")
        return payload

    async def get_policy_groups(self) -> list[dict[str, Any]]:
        """NSK-POLICY-002: read the approved, unpaginated policy-group listing (GET, no mutation).

        The response carries no total, so completeness cannot be proven: an empty list or one at the safety cap is
        refused instead of reaching reconciliation, where it would retire real groups.
        """
        if self.settings.policy_groups_path != POLICY_GROUPS_PATH:
            raise NetskopeNotConfigured("La ruta de grupos de políticas Netskope no está aprobada")
        payload = await self._request_json("GET", POLICY_GROUPS_PATH)
        if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
            raise NetskopeError("Netskope no devolvió data[] de grupos de políticas")
        if payload.get("status") not in (None, "success"):
            raise NetskopeError("Netskope no informó éxito al listar los grupos de políticas")
        groups = payload["data"]
        if not all(isinstance(item, dict) for item in groups):
            raise NetskopeError("Netskope devolvió grupos de políticas inválidos")
        if not groups:
            raise NetskopeError("Netskope devolvió una lista de grupos de políticas vacía")
        if len(groups) >= 500:
            raise NetskopeError("Netskope alcanzó el límite de seguridad de grupos de políticas")
        return groups

    def _require_rbac(self) -> None:
        if self.settings.rbac_path != RBAC_ROLES_PATH:
            raise NetskopeNotConfigured("La ruta de administradores y roles Netskope no está aprobada")

    async def get_admin_roles(self) -> list[dict[str, Any]]:
        """NSK-RBAC-001: every role, completeness-checked against the reported ``count`` (GET, no mutation).

        Without ``limit`` the tenant returns 25 of 32 roles and still reports ``count``: a short read must never reach
        reconciliation, where it would retire real roles.
        """
        self._require_rbac()
        payload = await self._request_json("GET", f"{RBAC_ROLES_PATH}?limit={RBAC_PAGE_SIZE}")
        if not isinstance(payload, dict) or not isinstance(payload.get("roles"), list):
            raise NetskopeError("Netskope no devolvió roles[] de roles de administración")
        roles = payload["roles"]
        if not all(isinstance(item, dict) for item in roles):
            raise NetskopeError("Netskope devolvió roles de administración inválidos")
        reported = payload.get("count")
        if isinstance(reported, bool) or not isinstance(reported, int) or reported < 0:
            raise NetskopeError("Netskope no informó count de roles de administración")
        if reported > RBAC_MAX_ROLES:
            raise NetskopeError("Netskope superó el límite de seguridad de roles de administración")
        if len(roles) != reported:
            raise NetskopeError(f"Netskope devolvió {len(roles)} de {reported} roles de administración")
        if not roles:
            raise NetskopeError("Netskope devolvió una lista de roles de administración vacía")
        return roles

    async def get_admin_role_detail(self, role_id: int) -> dict[str, Any]:
        """NSK-RBAC-001: one role with its API-group permissions (GET)."""
        self._require_rbac()
        # Predefined roles carry negative ids (-17..-1 on the tenant); only a non-integer is invalid.
        if isinstance(role_id, bool) or not isinstance(role_id, int):
            raise NetskopeError("roleId inválido para el detalle de rol")
        payload = await self._request_json("GET", f"{RBAC_ROLES_PATH}/{role_id}")
        if not isinstance(payload, dict) or not isinstance(payload.get("apiGroups"), list):
            raise NetskopeError("Netskope no devolvió apiGroups[] para el rol")
        if payload.get("roleId") != role_id:
            raise NetskopeError("Netskope devolvió un rol distinto del solicitado")
        if not all(isinstance(item, dict) for item in payload["apiGroups"]):
            raise NetskopeError("Netskope devolvió apiGroups inválidos")
        return payload

    async def get_admin_users(self) -> list[dict[str, Any]]:
        """NSK-RBAC-001: the tenant's administrators (SCIM, GET), paged by startIndex/count to ``totalResults``."""
        self._require_rbac()
        users: list[dict[str, Any]] = []
        total: int | None = None
        while total is None or len(users) < total:
            if users:
                await asyncio.sleep(self.settings.page_delay_seconds)
            start = len(users) + 1
            payload = await self._request_json("GET", f"{RBAC_ADMINS_PATH}?startIndex={start}&count={RBAC_PAGE_SIZE}")
            if not isinstance(payload, dict) or not isinstance(payload.get("Resources"), list):
                raise NetskopeError(f"La respuesta de administradores no contiene Resources[] en startIndex={start}")
            page = payload["Resources"]
            if not all(isinstance(item, dict) for item in page):
                raise NetskopeError("La respuesta de administradores contiene elementos inválidos")
            reported = payload.get("totalResults")
            if isinstance(reported, bool) or not isinstance(reported, int) or reported < 0:
                raise NetskopeError("Netskope no informó totalResults de administradores")
            if total is not None and reported != total:
                raise NetskopeError(f"Netskope reportó totalResults de administradores inconsistente ({total} luego {reported})")
            total = reported
            if total > RBAC_MAX_ADMINS:
                raise NetskopeError("Netskope superó el límite de seguridad de administradores")
            if not page and len(users) < total:
                raise NetskopeError("Netskope devolvió una página vacía de administradores antes de completar el total")
            users.extend(page)
        if len(users) != total:
            raise NetskopeError(f"Netskope devolvió {len(users)} de {total} administradores")
        if not users:
            raise NetskopeError("Netskope devolvió una lista de administradores vacía")
        return users

    async def get_api_group_pages(self) -> list[dict[str, Any]]:
        """NSK-RBAC-001: the static map from API groups to console pages (GET)."""
        self._require_rbac()
        payload = await self._request_json("GET", RBAC_PAGEMAPPING_PATH)
        if not isinstance(payload, list) or not all(isinstance(item, dict) for item in payload):
            raise NetskopeError("Netskope no devolvió una lista de páginas por grupo de API")
        if not payload:
            raise NetskopeError("Netskope devolvió un mapa de páginas vacío")
        return payload

    async def get_adem_pops(self, starttime: int, endtime: int) -> list[str]:
        """List POP codes observed among active users in a bounded window."""
        if starttime < 0 or endtime <= starttime or endtime - starttime > 48 * 3600:
            raise NetskopeError("La ventana ADEM debe ser de hasta 48 horas")
        path = f"{ADEM_POPLIST_PATH}?{urlencode({'starttime': starttime, 'endtime': endtime})}"
        payload = await self._request_json("GET", path)
        if not isinstance(payload, dict):
            raise NetskopeError("ADEM poplist no devolvió un objeto JSON")
        pops = payload.get("pops")
        total_count = payload.get("totalCount")
        if (not isinstance(pops, list) or len(pops) > 1000
                or not all(isinstance(pop, str) and 0 < len(pop.strip()) <= 120 for pop in pops)
                or isinstance(total_count, bool) or not isinstance(total_count, int)
                or total_count < len(pops)):
            raise NetskopeError("ADEM poplist devolvió una lista de POPs inválida")
        return [pop.strip() for pop in pops]

    async def _adem_device_query(self, path: str, user: str, starttime: int, endtime: int, **fields: Any) -> Any:
        if not user.strip() or len(user) > 320 or starttime < 0 or endtime <= starttime or endtime - starttime > 48 * 3600:
            raise NetskopeError('Usuario o ventana ADEM inválidos')
        return await self._request_json('POST', path, body={'user': user, 'starttime': starttime, 'endtime': endtime, **fields})

    async def get_adem_devices(self, user: str, starttime: int, endtime: int) -> list[dict[str, Any]]:
        payload = await self._adem_device_query('/api/v2/adem/users/device/getlist', user, starttime, endtime, userLocation=[])
        try:
            return map_adem_devices(payload)
        except ValueError as exc:
            raise NetskopeError(str(exc)) from exc

    async def get_adem_device_details(self, user: str, device_id: str, starttime: int, endtime: int) -> dict[str, Any]:
        if not device_id.strip() or len(device_id) > 160:
            raise NetskopeError('Identificador de dispositivo ADEM inválido')
        payload = await self._adem_device_query('/api/v2/adem/users/device/getdetails', user, starttime, endtime, deviceId=device_id)
        try:
            return map_adem_device_details(payload)
        except ValueError as exc:
            raise NetskopeError(str(exc)) from exc

    async def get_adem_user_score(self, user: str, starttime: int, endtime: int) -> int | float | None:
        payload = await self._adem_device_query('/api/v2/adem/users/getinfo', user, starttime, endtime)
        try:
            return map_adem_user_score(payload)
        except ValueError as exc:
            raise NetskopeError(str(exc)) from exc

    async def get_adem_device_scores(self, user: str, device_id: str, starttime: int, endtime: int) -> dict[str, Any]:
        if not device_id.strip() or len(device_id) > 160:
            raise NetskopeError('Identificador de dispositivo ADEM inválido')
        payload = await self._adem_device_query('/api/v2/adem/users/device/getaggregatedscores', user, starttime, endtime, deviceId=device_id)
        try:
            return map_adem_device_scores(payload)
        except ValueError as exc:
            raise NetskopeError(str(exc)) from exc
