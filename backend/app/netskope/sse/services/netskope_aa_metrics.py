"""AA severity metrics: explicit contract, public projection and memory cache."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
import re
from time import monotonic
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.netskope.sse.integrations.advanced_analytics import (
    AdvancedAnalyticsClient, AdvancedAnalyticsError, AdvancedAnalyticsSettings, AnalyticsResult,
)

CONTRACT_ENV = "NETSKOPE_AA_SEVERITY_CONTRACT_JSON"
APPROVAL_ENV = "NETSKOPE_AA_SEVERITY_APPROVAL_JSON"
MAX_SAFE_INTEGER = 2**53 - 1
SEVERITIES = {
    "critical": "critical", "high": "high", "medium": "medium", "low": "low",
    "informational": "informational", "info": "informational", "unknown": "unknown",
    "": "unknown", "null": "unknown", "none": "unknown", "n/a": "unknown",
}


class AnalyticsContractError(AdvancedAnalyticsError):
    """The configured widget does not yet have an approved metric contract."""


@dataclass(frozen=True)
class SeverityContract:
    report_id: str
    widget_id: str
    severity_column: str
    count_column: str
    window_days: int
    timezone: str
    scope: str
    unit: str

    @classmethod
    def from_environment(cls):
        raw = os.getenv(CONTRACT_ENV, "").strip()
        if not raw:
            return None
        try:
            value = json.loads(raw)
            expected = set(cls.__dataclass_fields__)
            if not isinstance(value, dict) or set(value) != expected:
                raise ValueError
            for key in ("report_id", "widget_id"):
                if not isinstance(value[key], str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value[key]):
                    raise ValueError
            for key in ("severity_column", "count_column"):
                column = value[key]
                if not isinstance(column, str) or not column.strip() or len(column) > 120 or any(ord(c) < 32 for c in column):
                    raise ValueError
            if value["severity_column"] == value["count_column"]:
                raise ValueError
            if type(value["window_days"]) is not int or not 1 <= value["window_days"] <= 365:
                raise ValueError
            if value["scope"] not in ("all_alerts", "dlp") or value["unit"] not in ("events", "incidents"):
                raise ValueError
            if not isinstance(value["timezone"], str):
                raise ValueError
            ZoneInfo(value["timezone"])
            return cls(**value)
        except (ValueError, TypeError, ZoneInfoNotFoundError):
            raise AnalyticsContractError("AA: contrato de severidad incompleto o inválido") from None

    def fingerprint(self) -> str:
        return hashlib.sha256(json.dumps(asdict(self), sort_keys=True, separators=(",", ":")).encode()).hexdigest()


@dataclass(frozen=True)
class SeverityApproval:
    """Operator attestation after inspecting the tenant's saved definition.

    The API available to DS Hub does not expose its filters/measure definition.
    Its SHA is evidence identity, not proof of automated remote drift detection.
    """

    version: int
    contract_sha256: str
    definition_sha256: str

    @classmethod
    def from_environment(cls, contract: SeverityContract):
        raw = os.getenv(APPROVAL_ENV, "").strip()
        if not raw:
            return None
        try:
            value = json.loads(raw)
            if not isinstance(value, dict) or set(value) != set(cls.__dataclass_fields__):
                raise ValueError
            if type(value["version"]) is not int or not 1 <= value["version"] <= 2**31 - 1:
                raise ValueError
            for key in ("contract_sha256", "definition_sha256"):
                if not isinstance(value[key], str) or not re.fullmatch(r"[a-f0-9]{64}", value[key]):
                    raise ValueError
            if value["contract_sha256"] != contract.fingerprint():
                raise ValueError
            return cls(**value)
        except (ValueError, TypeError):
            raise AnalyticsContractError("AA: aprobación de definición inválida o desactualizada") from None


def public_severity(result: AnalyticsResult, contract: SeverityContract) -> dict:
    """Only a two-column, one-row-per-severity aggregate can become this KPI.

    Reject additional dimensions and duplicate buckets rather than adding
    overlapping distinct counts or silently disclosing arbitrary labels.
    """
    expected = {contract.severity_column, contract.count_column}
    if result.format == "csv":
        table = result.payload
        if not isinstance(table, list) or not table or not isinstance(table[0], list):
            raise AdvancedAnalyticsError("AA: faltan encabezados del agregado")
        if len(table) - 1 >= 100:
            raise AdvancedAnalyticsError("AA: resultado potencialmente truncado")
        headers = table[0]
        # The tenant CSV export adds a blank-headed numeric row index. It is
        # transport formatting, not a third business dimension; validate its
        # sequence before discarding it. Named extra columns remain forbidden.
        if len(headers) == 3 and isinstance(headers[0], str) and not headers[0].strip():
            indexed_rows = table[1:]
            start = None
            stripped = []
            for position, cells in enumerate(indexed_rows):
                if (not isinstance(cells, list) or len(cells) != 3 or not isinstance(cells[0], str)
                        or not re.fullmatch(r"[0-9]{1,3}", cells[0].strip())):
                    raise AdvancedAnalyticsError("AA: índice CSV inválido")
                index = int(cells[0].strip())
                if start is None:
                    start = index
                if start not in (0, 1) or index != start + position:
                    raise AdvancedAnalyticsError("AA: índice CSV inválido")
                stripped.append(cells[1:])
            table = [headers[1:], *stripped]
            headers = table[0]
        if len(headers) != 2 or set(headers) != expected:
            raise AdvancedAnalyticsError("AA: columnas no aprobadas para severidad")
        rows = []
        for cells in table[1:]:
            if not isinstance(cells, list) or len(cells) != 2:
                raise AdvancedAnalyticsError("AA: fila agregada inválida")
            rows.append(dict(zip(headers, cells, strict=True)))
    elif result.format == "json":
        rows = result.payload.get("data") if isinstance(result.payload, dict) else result.payload
        if not isinstance(rows, list):
            raise AdvancedAnalyticsError("AA: resultado agregado sin filas")
    else:
        raise AdvancedAnalyticsError("AA: formato agregado no admitido")
    # The query requests 100 rows; hitting the cap can never become a total.
    if len(rows) >= 100:
        raise AdvancedAnalyticsError("AA: resultado potencialmente truncado")
    buckets = []
    seen = set()
    total = 0
    for row in rows:
        if not isinstance(row, dict) or set(row) != expected:
            raise AdvancedAnalyticsError("AA: columnas no aprobadas para severidad")
        raw_severity = row[contract.severity_column]
        if not isinstance(raw_severity, str):
            raise AdvancedAnalyticsError("AA: severidad inválida")
        severity = SEVERITIES.get(raw_severity.strip().lower())
        if severity is None or severity in seen:
            raise AdvancedAnalyticsError("AA: severidad desconocida o agrupación duplicada")
        seen.add(severity)
        count = row[contract.count_column]
        if isinstance(count, str) and re.fullmatch(r"[0-9]{1,16}", count.strip()):
            count = int(count.strip())
        if type(count) is not int or not 0 <= count <= MAX_SAFE_INTEGER:
            raise AdvancedAnalyticsError("AA: conteo inválido")
        total += count
        if total > MAX_SAFE_INTEGER:
            raise AdvancedAnalyticsError("AA: total fuera de rango")
        buckets.append({"key": severity, "count": count})
    return {
        "source": "advanced_analytics", "state": "ready" if rows else "empty",
        "window_days": contract.window_days, "timezone": contract.timezone,
        "scope": contract.scope, "unit": contract.unit,
        "buckets": buckets, "total": total if rows else None,
    }


class SeverityMetricsCache:
    """One bounded entry per worker; concurrent readers share the same query."""

    TTL_SECONDS = 300
    ERROR_TTL_SECONDS = 15

    def __init__(self):
        self._lock = asyncio.Lock()
        self._key = None
        self._expires_at = 0.0
        self._value = None
        self._error_until = 0.0

    async def get(self) -> dict:
        async with self._lock:
            try:
                contract = SeverityContract.from_environment()
                approval = SeverityApproval.from_environment(contract) if contract else None
            except AnalyticsContractError:
                self._key, self._value, self._expires_at, self._error_until = None, None, 0.0, 0.0
                raise
            if contract is None or approval is None:
                # Revoking approval also destroys an otherwise fresh result.
                self._key, self._value, self._expires_at, self._error_until = None, None, 0.0, 0.0
                return {"source": "advanced_analytics", "state": "not_configured" if contract is None else "pending_validation",
                        "buckets": [], "total": None, "window_days": None, "timezone": None, "scope": None, "unit": None,
                        "fetched_at": None, "cache_expires_at": None, "contract_version": None}
            settings = AdvancedAnalyticsSettings.from_environment()
            key = (contract, approval, settings.base_url, hashlib.sha256(settings.api_token.encode()).digest())
            now = monotonic()
            if key == self._key and self._value is not None and now < self._expires_at:
                return deepcopy(self._value)
            if key == self._key and now < self._error_until:
                raise AdvancedAnalyticsError("AA: consulta temporalmente no disponible")
            self._key, self._value = key, None
            try:
                async with AdvancedAnalyticsClient(settings) as client:
                    result = await client.query_widget(contract.report_id, contract.widget_id, limit=100)
                value = public_severity(result, contract)
            except AdvancedAnalyticsError:
                self._error_until = monotonic() + self.ERROR_TTL_SECONDS
                raise
            fetched_at = datetime.now(timezone.utc)
            value.update(fetched_at=fetched_at.isoformat(), cache_expires_at=(fetched_at + timedelta(seconds=self.TTL_SECONDS)).isoformat(),
                         contract_version=approval.version)
            self._value = value
            self._expires_at = monotonic() + self.TTL_SECONDS
            self._error_until = 0.0
            return deepcopy(value)
