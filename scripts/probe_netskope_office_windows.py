#!/usr/bin/env python3
"""NSK-EXP-OFFICE-001/v1: does ADEM ``getinfo`` score only the window it is asked for?

Read-only. Picks people whose devices reported from the office and from outside in the last
7 days (``netskope_device_presence_days``), derives one office span and one remote span per
person from the device snapshots (first and last client event of that day and status), and asks
``POST /api/v2/adem/users/getinfo`` for: the whole UTC day, the office span, its first half, a
night window with no expected activity, the remote span and the office span again. It prints
only anonymous indexes, scores, spans in minutes, ages in days and latencies: never an e-mail,
device id, hostname or IP. Each call is spaced to stay under the ADEM limit of 4 req/s.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from psycopg.rows import dict_row  # noqa: E402
from psycopg_pool import AsyncConnectionPool  # noqa: E402

from app.db import fetch_all  # noqa: E402
from app.netskope.sse.integrations.netskope import NetskopeClient, NetskopeError, NetskopeSettings  # noqa: E402
from app.netskope.sse.repositories.netskope_shared import valid_event_epoch  # noqa: E402

PROBE_VERSION = "NSK-EXP-OFFICE-001/v1"
DELAY = 0.3
MIN_SPAN = 30 * 60

# One office and one remote span per person: the first and last event of the most recent day with
# that status, read from the snapshots of the person's active devices.
SPANS_SQL = f"""
WITH hybrid AS (
    SELECT lower(btrim(o.attributes->>'username')) AS email
    FROM public.cyberark_inventory_objects o
    JOIN public.netskope_device_presence_days p
      ON p.device_id = o.source_id AND p.event_day > (now() AT TIME ZONE 'UTC')::date - 7
    WHERE o.source_system = 'netskope' AND o.object_type = 'device' AND o.lifecycle_status = 'active'
      AND o.attributes->>'username' LIKE '%%@%%'
    GROUP BY 1
    HAVING bool_or(p.onprem_status = 'on-prem') AND bool_or(p.onprem_status = 'off-prem')
    ORDER BY md5(lower(btrim(o.attributes->>'username')))
    LIMIT %s
),
events AS (
    SELECT h.email, s.attributes->>'onprem_status' AS status, {valid_event_epoch('s.captured_at').replace('attributes', 's.attributes')} AS epoch
    FROM hybrid h
    JOIN public.cyberark_inventory_objects o
      ON o.source_system = 'netskope' AND o.object_type = 'device' AND o.lifecycle_status = 'active'
     AND lower(btrim(o.attributes->>'username')) = h.email
    JOIN public.netskope_device_snapshots s
      ON s.device_id = o.source_id AND s.captured_at >= now() - interval '7 days'
    WHERE s.attributes->>'onprem_status' IN ('on-prem', 'off-prem')
),
days AS (
    SELECT email, status, (to_timestamp(epoch) AT TIME ZONE 'UTC')::date AS day,
           min(epoch)::bigint AS first_event, max(epoch)::bigint AS last_event
    FROM events WHERE epoch IS NOT NULL
    GROUP BY 1, 2, 3
)
SELECT DISTINCT ON (email, status) email, status, day, first_event, last_event
FROM days
WHERE last_event - first_event >= {MIN_SPAN}
ORDER BY email, status, day DESC
"""


async def score(client: NetskopeClient, user: str, start: int, end: int) -> tuple[float | int | None | str, float]:
    started = time.monotonic()
    try:
        value = await client.get_adem_user_score(user, start, end)
    except NetskopeError as exc:
        value = f"error:{type(exc).__name__}"
    elapsed = time.monotonic() - started
    await asyncio.sleep(DELAY)
    return value, round(elapsed, 2)


async def probe(people: int) -> None:
    async with AsyncConnectionPool(os.environ["DATABASE_URL"], kwargs={"row_factory": dict_row}, open=False) as pool:
        rows = await fetch_all(pool, SPANS_SQL, (people,))
    spans: dict[str, dict[str, dict]] = {}
    for row in rows:
        spans.setdefault(row["email"], {})[row["status"]] = row
    complete = [(email, value) for email, value in spans.items() if {"on-prem", "off-prem"} <= value.keys()]
    now = datetime.now(timezone.utc)
    results = []
    latencies = []
    async with NetskopeClient(NetskopeSettings.from_environment()) as client:
        for index, (email, value) in enumerate(complete, 1):
            office, remote = value["on-prem"], value["off-prem"]
            day_start = int(datetime.combine(office["day"], datetime.min.time(), timezone.utc).timestamp())
            a, b = office["first_event"], office["last_event"]
            windows = {
                "day_24h": (day_start, day_start + 86400),
                "office_span": (a, b),
                "office_first_half": (a, a + (b - a) // 2),
                "night_06_08_utc": (day_start + 6 * 3600, day_start + 8 * 3600),
                "remote_span": (remote["first_event"], remote["last_event"]),
                "office_span_repeat": (a, b),
            }
            scores = {}
            for name, (start, end) in windows.items():
                scores[name], elapsed = await score(client, email, start, end)
                latencies.append(elapsed)
            results.append({
                "person": index,
                "office_age_days": (now.date() - office["day"]).days,
                "remote_age_days": (now.date() - remote["day"]).days,
                "office_span_min": (b - a) // 60,
                "remote_span_min": (remote["last_event"] - remote["first_event"]) // 60,
                "scores": scores,
            })
    numeric = lambda value: isinstance(value, (int, float)) and not isinstance(value, bool)  # noqa: E731
    differs = [r for r in results if numeric(r["scores"]["day_24h"]) and numeric(r["scores"]["office_span"]) and r["scores"]["day_24h"] != r["scores"]["office_span"]]
    half_differs = [r for r in results if numeric(r["scores"]["office_span"]) and numeric(r["scores"]["office_first_half"]) and r["scores"]["office_span"] != r["scores"]["office_first_half"]]
    print(json.dumps({
        "probe_version": PROBE_VERSION, "generated_at": now.isoformat(timespec="seconds"),
        "people_with_both_spans": len(complete),
        "office_span_differs_from_day": len(differs),
        "first_half_differs_from_span": len(half_differs),
        "night_window_null": sum(1 for r in results if r["scores"]["night_06_08_utc"] is None),
        "repeat_equal": sum(1 for r in results if r["scores"]["office_span"] == r["scores"]["office_span_repeat"]),
        "latency_s": {"median": statistics.median(latencies) if latencies else None, "max": max(latencies, default=None), "calls": len(latencies)},
        "results": results,
    }, indent=1, default=str))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--people", type=int, default=12, help="Personas híbridas a consultar (1–40).")
    args = parser.parse_args()
    if not 1 <= args.people <= 40:
        parser.error("--people debe estar entre 1 y 40")
    load_dotenv(Path(os.getenv("ENV_FILE", ROOT / ".env.local")), override=False)
    asyncio.run(probe(args.people))
