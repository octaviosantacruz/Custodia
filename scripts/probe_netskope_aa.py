#!/usr/bin/env python3
"""NSK-AA-DISCOVERY-001/v2: bounded AA discovery (GET by default, optional query task), no payload values."""

from __future__ import annotations

import argparse
import asyncio
import csv
import io
import json
import math
import os
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
MAX_BYTES = 2 * 1024 * 1024
MAX_WIDGETS = 3
sys.path.insert(0, str(ROOT / "backend"))

from app.netskope.sse.integrations.advanced_analytics import AdvancedAnalyticsClient, AdvancedAnalyticsError
from app.netskope.sse.integrations.netskope import NetskopeSettings


def value_type(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    return "array" if isinstance(value, list) else "object"


def shape(payload: Any) -> dict[str, Any]:
    """Even object keys may encode user values: report only types and counts."""
    result: dict[str, Any] = {"type": value_type(payload)}
    if isinstance(payload, dict):
        result["field_count"] = len(payload)
        result["value_types"] = dict(Counter(value_type(value) for value in payload.values()))
        for key in ("data", "widgets"):
            if key in payload:
                result[f"{key}_shape"] = shape(payload[key])
    elif isinstance(payload, list):
        result["row_count"] = len(payload)
        result["row_types"] = dict(Counter(value_type(value) for value in payload))
        if payload:
            result["first_row_shape"] = shape(payload[0])
    return result


def identifier(value: Any) -> str | None:
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        return None
    text = str(value)
    return text if re.fullmatch(r"[A-Za-z0-9_-]{1,128}", text) else None


def rows(payload: Any) -> list[dict[str, Any]]:
    data = payload.get("data") if isinstance(payload, dict) else payload
    if isinstance(data, dict):
        data = data.get("widgets")
    return [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []


def categories(name: Any) -> list[str]:
    """Fixed labels only; catalog titles may contain personal values."""
    if not isinstance(name, str):
        return []
    patterns = {"dlp": r"\bdlp\b|data loss", "severity": r"severity",
                "trend": r"trend|over time", "identity": r"\buser|email|employee"}
    return [label for label, pattern in patterns.items() if re.search(pattern, name, re.I)]


async def discover(client: httpx.AsyncClient, *, topic: str = "all", async_query: bool = False) -> dict[str, Any]:
    """GET: five requests max. Async: catalogs + one task + six polls + result."""
    results: list[dict[str, Any]] = []

    async def fetch(path: str, label: str, params=None) -> Any:
        payload = None
        delay = 0.25
        try:
            async with client.stream("GET", path, params=params) as response:
                entry: dict[str, Any] = {"endpoint": label, "http_status": response.status_code}
                content_type = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
                entry["content_type"] = content_type if content_type in (
                    "application/json", "text/csv", "application/csv", "text/plain", "text/html",
                ) else "other"
                results.append(entry)
                try:
                    reset = float(response.headers.get("ratelimit-reset", "0"))
                    if response.status_code == 429 or response.headers.get("ratelimit-remaining") == "0":
                        if math.isfinite(reset) and reset > delay:
                            delay = reset
                except ValueError:
                    pass
                if response.status_code != 200:
                    return None
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > MAX_BYTES:
                        entry["error_kind"] = "response_size_limit"
                        return None
                try:
                    payload = json.loads(body)
                except ValueError:
                    if content_type in ("text/csv", "application/csv"):
                        try:
                            csv_rows = list(csv.reader(io.StringIO(body.decode("utf-8-sig"))))
                            entry["shape"] = {"type": "csv", "row_count": max(0, len(csv_rows) - 1),
                                              "column_count": len(csv_rows[0]) if csv_rows else 0}
                        except (UnicodeError, csv.Error):
                            entry["error_kind"] = "invalid_csv"
                    else:
                        entry["error_kind"] = "invalid_json"
                    return None
                entry["shape"] = shape(payload)
                return payload
        except httpx.HTTPError:
            results.append({"endpoint": label, "http_status": 0, "error_kind": "network_error"})
            return None
        finally:
            await asyncio.sleep(delay)

    if topic not in ("all", "dlp"):
        raise ValueError("invalid_topic")
    reports = rows(await fetch("/api/v2/reporting/aa/reports", "aa/reports"))
    if topic == "dlp":
        reports = [row for row in reports if "dlp" in categories(row.get("report_name"))
                   and "identity" not in categories(row.get("report_name"))]
    report_id = next((item for row in reports if (item := identifier(row.get("report_id")))), None)
    if report_id:
        widgets = rows(await fetch(
            f"/api/v2/reporting/aa/reports/{report_id}/widgets", "aa/reports/{reportId}/widgets",
        ))
        results[-1]["candidates"] = [{"position": i, "categories": categories(row.get("widget_name"))}
                                     for i, row in enumerate(widgets)]
        if topic == "dlp":
            widgets = [row for row in widgets if "dlp" in categories(row.get("widget_name"))
                       and "identity" not in categories(row.get("widget_name"))
                       and any(label in categories(row.get("widget_name")) for label in ("severity", "trend"))]
        widget_ids = list(dict.fromkeys(item for row in widgets if (item := identifier(row.get("widget_id")))))
        if async_query and widget_ids:
            settings = NetskopeSettings(str(client.base_url).rstrip("/"), client.headers["Netskope-API-Token"], "", "", "")
            async with AdvancedAnalyticsClient(settings, client) as aa:
                try:
                    result = await aa.query_widget(report_id, widget_ids[0], limit=2, max_polls=6)
                    summary = shape(result.payload) if result.format == "json" else {
                        "type": "csv", "row_count": max(0, len(result.payload) - 1),
                        "column_count": len(result.payload[0]) if result.payload else 0,
                    }
                    results.append({"endpoint": "aa/async-workflow", "completed": True, "shape": summary})
                except AdvancedAnalyticsError:
                    results.append({"endpoint": "aa/async-workflow", "completed": False, "error_kind": "aa_query_error"})
        for widget_id in ([] if async_query else widget_ids[:MAX_WIDGETS]):
            await fetch(
                f"/api/v2/reporting/aa/reports/{report_id}/widgets/{widget_id}",
                "aa/reports/{reportId}/widgets/{widgetId}",
                {"limit": 1, "resultFormat": "json"},
            )
    return {"probe_version": "NSK-AA-DISCOVERY-001/v2", "read_only": not async_query,
            "creates_query_task": async_query, "topic": topic, "results": results}


async def main(*, topic: str = "all", async_query: bool = False) -> None:
    load_dotenv(ROOT / ".env.local", override=False)
    base = os.getenv("NETSKOPE_URL", "").strip().rstrip("/")
    parsed = urlparse(base)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("invalid_https_base")
    token = os.getenv("NETSKOPE_API_TOKEN", "").strip()
    token_file = os.getenv("NETSKOPE_API_TOKEN_FILE", "").strip()
    if not token and token_file:
        path = Path(token_file)
        token = (path if path.is_absolute() else ROOT / path).read_text().strip()
    if not token or "\n" in token or "\r" in token:
        raise ValueError("missing_or_invalid_token")
    async with httpx.AsyncClient(
        base_url=base, headers={"Netskope-API-Token": token, "Accept": "application/json"},
        timeout=20, follow_redirects=False,
    ) as client:
        print(json.dumps(await discover(client, topic=topic, async_query=async_query)))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--topic", choices=("all", "dlp"), default="all")
    parser.add_argument("--async-query", action="store_true", help="Create one bounded query task; does not modify reports")
    args = parser.parse_args()
    try:
        asyncio.run(main(topic=args.topic, async_query=args.async_query))
    except (ValueError, OSError) as exc:
        # Never print an exception message that could include a URL or secret.
        print(json.dumps({"probe_version": "NSK-AA-DISCOVERY-001/v2", "error_kind": type(exc).__name__}))
        raise SystemExit(1) from None
