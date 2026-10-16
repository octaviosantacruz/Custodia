#!/usr/bin/env python3
"""Build one NETSKOPE_AA_CHARTS_JSON entry from a report id and a widget title.

GET the report's widgets, find the title, run one bounded query to detect the two
columns, and print the entry. Prints column names, never row values. The period and
unit are what you read in the Netskope console: review them before pasting.
"""

import argparse
import asyncio
import json
from pathlib import Path
import sys

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.netskope.sse.integrations.advanced_analytics import AdvancedAnalyticsClient, AdvancedAnalyticsSettings


def _headers(result):
    if result.format == "csv":
        headers = [str(cell).strip() for cell in (result.payload[0] if result.payload else [])]
    else:
        rows = result.payload.get("data") if isinstance(result.payload, dict) else result.payload
        headers = [str(key).strip() for key in (rows[0] if rows and isinstance(rows[0], dict) else {})]
    # The tenant CSV export prefixes a blank-headed row index.
    return [header for header in headers if header]


async def main(args):
    load_dotenv(ROOT / ".env.local", override=False)
    async with AdvancedAnalyticsClient(AdvancedAnalyticsSettings.from_environment()) as client:
        payload = await client.list_catalog("widgets", report_id=args.report_id)
        data = payload.get("data")
        widgets = data.get("widgets") if isinstance(data, dict) else data
        needle = args.title.casefold()
        matches = [w for w in widgets if needle in str(w.get("widget_name", "")).casefold()]
        if len(matches) != 1:
            print(json.dumps({"matches": [{"widget_id": w.get("widget_id"), "title": w.get("widget_name")} for w in (matches or widgets)]}, indent=2, ensure_ascii=False))
            raise SystemExit("Elegí un título que coincida con un solo widget.")
        widget = matches[0]
        headers = _headers(await client.query_widget(args.report_id, str(widget["widget_id"]), limit=100))
    if len(headers) != 2:
        raise SystemExit(f"El widget devuelve {len(headers)} columnas ({headers}); sólo sirve uno de etiqueta + valor.")
    entry = {args.key: {"title": widget["widget_name"], "report_id": args.report_id, "widget_id": str(widget["widget_id"]),
                        "label_column": headers[0], "value_column": headers[1], "unit": args.unit, "period": args.period}}
    print(json.dumps(entry, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report-id", required=True)
    parser.add_argument("--title", required=True, help="Texto del título del widget (debe coincidir con uno solo)")
    parser.add_argument("--key", required=True, help="Clave corta: minúsculas, números y _ (queda como aa_<clave>)")
    parser.add_argument("--unit", required=True, help="Qué cuenta el valor, por ejemplo: aplicaciones")
    parser.add_argument("--period", required=True, help="Período que muestra la consola, por ejemplo: Catálogo actual")
    asyncio.run(main(parser.parse_args()))
