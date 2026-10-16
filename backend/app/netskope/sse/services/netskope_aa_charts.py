"""Tenant-declared AA charts: a map of chart key to report/widget, projected to label + count.

The map lives in `NETSKOPE_AA_CHARTS_JSON` (tenant IDs never ship in the code and never reach
the browser). Whoever adds an entry attests the period and unit they read in the Netskope
console; results are never persisted, only held in a short per-process memory cache.
"""

from __future__ import annotations

import asyncio
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
import re
from time import monotonic

from app.netskope.sse.integrations.advanced_analytics import (
    AdvancedAnalyticsClient, AdvancedAnalyticsError, AdvancedAnalyticsSettings, AnalyticsResult,
)
from app.netskope.sse.services.netskope_aa_metrics import AnalyticsContractError

CHARTS_ENV = "NETSKOPE_AA_CHARTS_JSON"
WIDGET_PREFIX = "aa_"
KEY_PATTERN = re.compile(r"[a-z0-9][a-z0-9_]{0,39}")
MAX_CHARTS = 24
MAX_ROWS = 100
MAX_SAFE_INTEGER = 2**53 - 1
EMPTY_LABEL = "Sin dato"
_FIELDS = {"title", "report_id", "widget_id", "label_column", "value_column", "unit", "period"}
_OPTIONAL_FIELDS = {"labels"}
MAX_LABELS = 40


@dataclass(frozen=True)
class AaChart:
    key: str
    title: str
    report_id: str
    widget_id: str
    label_column: str
    value_column: str
    unit: str
    period: str
    # Spanish display names for the labels Netskope returns (matched exactly, ignoring surrounding spaces).
    labels: tuple[tuple[str, str], ...] = field(default=())

    @property
    def widget(self) -> str:
        """The dashboard widget id this chart is offered under."""
        return WIDGET_PREFIX + self.key


def _text(value, limit: int) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit or any(ord(c) < 32 for c in value):
        raise ValueError
    return value.strip()


def aa_charts() -> dict[str, AaChart]:
    """Parse the configured map; an empty variable means no charts, an invalid one fails closed."""
    raw = os.getenv(CHARTS_ENV, "").strip()
    if not raw:
        return {}
    try:
        value = json.loads(raw)
        if not isinstance(value, dict) or len(value) > MAX_CHARTS:
            raise ValueError
        charts = {}
        for key, entry in value.items():
            if not KEY_PATTERN.fullmatch(key) or not isinstance(entry, dict) or not _FIELDS <= set(entry) <= _FIELDS | _OPTIONAL_FIELDS:
                raise ValueError
            for field in ("report_id", "widget_id"):
                if not isinstance(entry[field], str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", entry[field]):
                    raise ValueError
            label, count = _text(entry["label_column"], 120), _text(entry["value_column"], 120)
            if label == count:
                raise ValueError
            labels = entry.get("labels", {})
            if not isinstance(labels, dict) or len(labels) > MAX_LABELS:
                raise ValueError
            names = tuple((_text(raw, 120), _text(shown, 80)) for raw, shown in labels.items())
            charts[key] = AaChart(key, _text(entry["title"], 80), entry["report_id"], entry["widget_id"], label, count,
                                  _text(entry["unit"], 40), _text(entry["period"], 60), names)
        return charts
    except (ValueError, TypeError):
        raise AnalyticsContractError("AA: el mapa de gráficos es inválido") from None


def aa_chart_for_widget(widget_id: str) -> AaChart | None:
    """The configured chart behind a dashboard widget id; invalid configuration counts as none."""
    if not widget_id.startswith(WIDGET_PREFIX):
        return None
    try:
        return aa_charts().get(widget_id[len(WIDGET_PREFIX):])
    except AnalyticsContractError:
        return None


def public_chart(result: AnalyticsResult, chart: AaChart) -> dict:
    """Only a label + count aggregate with one row per label becomes a chart.

    The tenant CSV export may add a blank-headed numeric row index; it is transport
    formatting and is dropped after its sequence is verified. Header whitespace is ignored
    (the tenant exports ' # Applications'). Any other extra column,
    a duplicate label or a result that reached the row cap is rejected.
    """
    expected = {chart.label_column, chart.value_column}
    if result.format == "csv":
        table = result.payload
        if not isinstance(table, list) or not table or not isinstance(table[0], list):
            raise AdvancedAnalyticsError("AA: faltan encabezados del agregado")
        headers, body = [h.strip() if isinstance(h, str) else h for h in table[0]], table[1:]
        if len(headers) == 3 and isinstance(headers[0], str) and not headers[0].strip():
            start, stripped = None, []
            for position, cells in enumerate(body):
                if (not isinstance(cells, list) or len(cells) != 3 or not isinstance(cells[0], str)
                        or not re.fullmatch(r"[0-9]{1,3}", cells[0].strip())):
                    raise AdvancedAnalyticsError("AA: índice CSV inválido")
                index = int(cells[0].strip())
                start = index if start is None else start
                if start not in (0, 1) or index != start + position:
                    raise AdvancedAnalyticsError("AA: índice CSV inválido")
                stripped.append(cells[1:])
            headers, body = headers[1:], stripped
        if len(headers) != 2 or set(headers) != expected:
            raise AdvancedAnalyticsError("AA: columnas no aprobadas para el gráfico")
        rows = []
        for cells in body:
            if not isinstance(cells, list) or len(cells) != 2:
                raise AdvancedAnalyticsError("AA: fila agregada inválida")
            rows.append(dict(zip(headers, cells, strict=True)))
    elif result.format == "json":
        rows = result.payload.get("data") if isinstance(result.payload, dict) else result.payload
        if not isinstance(rows, list):
            raise AdvancedAnalyticsError("AA: resultado agregado sin filas")
    else:
        raise AdvancedAnalyticsError("AA: formato agregado no admitido")
    if len(rows) >= MAX_ROWS:
        raise AdvancedAnalyticsError("AA: resultado potencialmente truncado")
    names = dict(chart.labels)
    buckets, seen, total = [], set(), 0
    for row in rows:
        if not isinstance(row, dict) or set(row) != expected:
            raise AdvancedAnalyticsError("AA: columnas no aprobadas para el gráfico")
        label = row[chart.label_column]
        if label is None:
            label = ""
        if not isinstance(label, str):
            raise AdvancedAnalyticsError("AA: etiqueta inválida")
        label = names.get(label.strip(), label.strip()) or EMPTY_LABEL
        if label in seen:
            raise AdvancedAnalyticsError("AA: etiqueta duplicada")
        seen.add(label)
        count = row[chart.value_column]
        if isinstance(count, str):
            text = count.strip()
            # The tenant export groups thousands with commas ("12,345"); only that exact grouping is a whole number.
            if re.fullmatch(r"[0-9]{1,3}(,[0-9]{3})+", text):
                text = text.replace(",", "")
            if re.fullmatch(r"[0-9]{1,16}", text):
                count = int(text)
        if type(count) is not int or not 0 <= count <= MAX_SAFE_INTEGER:
            raise AdvancedAnalyticsError("AA: conteo inválido")
        total += count
        if total > MAX_SAFE_INTEGER:
            raise AdvancedAnalyticsError("AA: total fuera de rango")
        buckets.append({"key": label, "count": count})
    buckets.sort(key=lambda bucket: (-bucket["count"], bucket["key"]))
    return {"source": "advanced_analytics", "key": chart.key, "title": chart.title, "unit": chart.unit,
            "period": chart.period, "state": "ready" if rows else "empty",
            "buckets": buckets, "total": total if rows else None}


class AaChartCache:
    """One bounded entry per chart and worker; concurrent readers share the same query."""

    TTL_SECONDS = 300
    ERROR_TTL_SECONDS = 15

    def __init__(self):
        self._locks: dict[str, asyncio.Lock] = {}
        self._entries: dict[str, dict] = {}

    async def get(self, chart: AaChart) -> dict:
        lock = self._locks.setdefault(chart.key, asyncio.Lock())
        async with lock:
            settings = AdvancedAnalyticsSettings.from_environment()
            identity = (chart, settings.base_url, hashlib.sha256(settings.api_token.encode()).digest())
            entry = self._entries.get(chart.key)
            now = monotonic()
            if entry and entry["identity"] == identity:
                if entry["value"] is not None and now < entry["expires_at"]:
                    return deepcopy(entry["value"])
                if now < entry["error_until"]:
                    raise AdvancedAnalyticsError("AA: consulta temporalmente no disponible")
            entry = self._entries[chart.key] = {"identity": identity, "value": None, "expires_at": 0.0, "error_until": 0.0}
            try:
                async with AdvancedAnalyticsClient(settings) as client:
                    result = await client.query_widget(chart.report_id, chart.widget_id, limit=MAX_ROWS)
                value = public_chart(result, chart)
            except AdvancedAnalyticsError:
                entry["error_until"] = monotonic() + self.ERROR_TTL_SECONDS
                raise
            fetched_at = datetime.now(timezone.utc)
            value.update(fetched_at=fetched_at.isoformat(),
                         cache_expires_at=(fetched_at + timedelta(seconds=self.TTL_SECONDS)).isoformat())
            entry["value"], entry["expires_at"] = value, monotonic() + self.TTL_SECONDS
            return deepcopy(value)
