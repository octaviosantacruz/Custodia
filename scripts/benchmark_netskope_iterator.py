#!/usr/bin/env python3
"""NSK-ITER-BENCH-001/v1: compare bounded read-only DLP batches, no DB writes."""

from __future__ import annotations

import asyncio
import importlib.util
import json
import subprocess
import sys
import tempfile
import time
import tracemalloc
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.netskope.sse.integrations.netskope import NetskopeClient, NetskopeSettings  # noqa: E402
from app.netskope.sse.services.netskope_dlp_alerts import sanitize_dlp_incident  # noqa: E402

PAGES = 3


async def sample(client_class, settings, start, now, *, retain):
    index = f"dshub-bench-{uuid4()}"
    operation = str(int(start.timestamp()))
    ids = set()
    retained = {}
    requests = 0
    events = 0
    waits = []
    http_ms = []
    hwm = None
    error_kind = None
    began = time.monotonic()
    tracemalloc.start()
    try:
        async with client_class(settings) as client:
            for page in range(PAGES):
                if page:
                    await asyncio.sleep(max(settings.page_delay_seconds, waits[-1]) if not retain else settings.page_delay_seconds)
                began_request = time.monotonic()
                payload = await client.get_dlp_incident_page(operation, index)
                http_ms.append(round((time.monotonic() - began_request) * 1000))
                requests += 1
                rows = payload.get("result", [])
                if not isinstance(rows, list):
                    raise ValueError("invalid_page")
                waits.append(float(payload.get("wait_time", 0)))
                events += len(rows)
                for row in rows:
                    alert = sanitize_dlp_incident(row, now=now)
                    if alert:
                        ids.add(alert["incident_id"])
                        if retain:
                            retained[alert["incident_id"]] = alert
                hwm = payload.get("timestamp_hwm")
                operation = "next"
    except Exception as exc:
        error_kind = type(exc).__name__
    finally:
        _, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
    elapsed_ms = round((time.monotonic() - began) * 1000)
    return {
        "pages": requests, "events": events, "distinct_incidents": len(ids),
        "elapsed_ms": elapsed_ms, "http_ms": http_ms, "server_wait_seconds": waits,
        "python_peak_kib": round(peak / 1024), "error_kind": error_kind,
        "watermark_age_seconds": max(0, int(now.timestamp() - hwm)) if isinstance(hwm, (int, float)) else None,
    }, ids


async def main():
    load_dotenv(ROOT / ".env.local", override=False)
    settings = NetskopeSettings.from_environment()
    # Load the committed client, never alter files in the checkout.
    relative = "backend/app/netskope/sse/integrations/netskope.py"
    # Pin the pre-change baseline so concurrent commits cannot change it.
    revision = "4889d4ec4ad9c4cac31c3232aa1a29a7ddbb85e9"
    baseline = subprocess.check_output(["git", "show", f"{revision}:{relative}"], cwd=ROOT, text=True)
    now = datetime.now(timezone.utc)
    start = now - timedelta(hours=24)
    results = []
    with tempfile.TemporaryDirectory(prefix="dshub-benchmark-") as directory:
        path = Path(directory) / "baseline_client.py"
        path.write_text(baseline)
        spec = importlib.util.spec_from_file_location("benchmark_baseline_client", path)
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        for order in (("baseline", "current"), ("current", "baseline")):
            pair = {}
            id_sets = {}
            for mode in order:
                cls = module.NetskopeClient if mode == "baseline" else NetskopeClient
                pair[mode], id_sets[mode] = await sample(cls, settings, start, now, retain=mode == "baseline")
            pair["same_incident_ids"] = id_sets["baseline"] == id_sets["current"]
            results.append(pair)
    print(json.dumps({
        "probe_version": "NSK-ITER-BENCH-001/v1", "baseline_revision": revision,
        "database_writes": False, "window_hours": 24, "pages_per_batch": PAGES,
        "rounds": results,
        "limitation": "Small serial sample; excludes SQL, commit latency, failures and full sync. Python peak includes HTTP/JSON allocations, not process RSS.",
    }))


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:
        print(json.dumps({"error_kind": type(exc).__name__}))
        raise SystemExit(1) from None
