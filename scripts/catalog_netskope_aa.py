#!/usr/bin/env python3
"""Discover AA metadata indexes without executing or saving widget results."""

import argparse
import asyncio
import json
from pathlib import Path
import sys

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.netskope.sse.integrations.advanced_analytics import AdvancedAnalyticsClient, AdvancedAnalyticsSettings
from app.netskope.sse.services.netskope_aa_catalog import discover_catalog


async def main(output):
    load_dotenv(ROOT / ".env.local", override=False)

    def progress(done, total, errors):
        if done % 10 == 0 or done == total:
            print(json.dumps({"reports_processed": done, "reports_returned": total, "unavailable": errors}), flush=True)

    async with AdvancedAnalyticsClient(AdvancedAnalyticsSettings.from_environment()) as client:
        catalog = await discover_catalog(client, progress=progress)
    # Exclusive creation prevents replacing an existing file/configuration.
    with Path(output).open("x", encoding="utf-8") as stream:
        json.dump(catalog, stream, indent=2)
        stream.write("\n")
    print(json.dumps({"complete": catalog["complete_for_returned_reports"], "report_count": len(catalog["reports"]),
                      "widget_count": len(catalog["widgets"]), "candidates": {key: len(rows) for key, rows in catalog["metric_candidates"].items()}}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, help="New JSON file for projected metadata only")
    args = parser.parse_args()
    try:
        asyncio.run(main(args.output))
    except Exception as exc:
        print(json.dumps({"success": False, "error_kind": type(exc).__name__}))
        raise SystemExit(1) from None
