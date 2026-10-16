#!/usr/bin/env python3
"""NSK-EXP-DISCOVERY-001/v1: read-only discovery for Experiencia digital (ADEM, UBA, client IP, alert origin).

Reports, per endpoint, the HTTP status and the shape of the payload: field paths,
value types, and for strings a class (ip, email, uuid, hostname, label, text) with
the distinct count. It never prints an identifier, an IP or an e-mail: only plain
low-cardinality labels of fields whose name says they are a category (site, pop,
network, access method, status...) are echoed, because the point is to learn what
those categories mean. Optional ``NETSKOPE_PROBE_EGRESS_FILE`` (one IP per line,
outside the repository) is used only to count how many alert events came from
those addresses; the addresses are never echoed.
"""

from __future__ import annotations

import argparse
import asyncio
import ipaddress
import json
import os
import re
import statistics
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.netskope.sse.integrations.netskope import NetskopeClient, NetskopeError, NetskopeSettings  # noqa: E402

PROBE_VERSION = "NSK-EXP-DISCOVERY-001/v1"
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
HOSTNAME = re.compile(r"^(?=.*[0-9-])[A-Za-z0-9][A-Za-z0-9_.-]{2,}$")
LABEL = re.compile(r"^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ _/()-]{0,39}$")
SAFE_NAME = re.compile(r"(site|location|pop|network|access|connection|method|status|type|state|category|rating|severity|action|os|ssid|tunnel|mode)", re.I)
MAX_ECHO_DISTINCT = 15
DELAY = 0.35


def text_class(value: str) -> str:
    try:
        ipaddress.ip_address(value.strip())
        return "ip"
    except ValueError:
        pass
    if EMAIL.match(value):
        return "email"
    if UUID.match(value):
        return "uuid"
    if re.fullmatch(r"\d{9,13}", value):
        return "epoch_like"
    if LABEL.match(value):
        return "label"
    if HOSTNAME.match(value):
        return "hostname_or_id"
    return "text"


class Field:
    def __init__(self) -> None:
        self.types: Counter[str] = Counter()
        self.classes: Counter[str] = Counter()
        self.strings: set[str] = set()
        self.numbers: list[float] = []
        self.array_lengths: list[int] = []

    def add(self, value: Any) -> None:
        if value is None:
            self.types["null"] += 1
        elif isinstance(value, bool):
            self.types["boolean"] += 1
        elif isinstance(value, (int, float)):
            self.types["number"] += 1
            self.numbers.append(float(value))
        elif isinstance(value, str):
            self.types["string"] += 1
            self.classes[text_class(value)] += 1
            if len(self.strings) < 5000:
                self.strings.add(value)
        elif isinstance(value, list):
            self.types["array"] += 1
            self.array_lengths.append(len(value))
        else:
            self.types["object"] += 1


def walk(value: Any, path: str, fields: dict[str, Field], depth: int = 0) -> None:
    if depth > 5:
        return
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = f"{path}.{key}" if path else str(key)
            fields.setdefault(child_path, Field()).add(child)
            walk(child, child_path, fields, depth + 1)
    elif isinstance(value, list):
        for child in value[:200]:
            walk(child, f"{path}[]", fields, depth + 1)


def describe(payload: Any) -> dict[str, Any]:
    fields: dict[str, Field] = {}
    root = Field()
    root.add(payload)
    walk(payload, "$", fields)
    described: dict[str, Any] = {}
    for path, field in sorted(fields.items()):
        entry: dict[str, Any] = {"types": dict(field.types)}
        if field.classes:
            entry["string_classes"] = dict(field.classes)
            entry["distinct"] = len(field.strings)
            name = path.rsplit(".", 1)[-1]
            if (SAFE_NAME.search(name) and field.classes.keys() <= {"label"}
                    and len(field.strings) <= MAX_ECHO_DISTINCT):
                entry["labels"] = sorted(field.strings)
        if field.numbers:
            entry["number_range"] = {"min": min(field.numbers), "median": statistics.median(field.numbers), "max": max(field.numbers), "n": len(field.numbers)}
        if field.array_lengths:
            entry["array_len"] = {"min": min(field.array_lengths), "max": max(field.array_lengths)}
        described[path] = entry
    return {"root_type": dict(root.types), "fields": described}


async def call(client: NetskopeClient, method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    started = time.monotonic()
    await asyncio.sleep(DELAY)
    try:
        payload = await client._request_json(method, path, body=body)  # noqa: SLF001 - probe uses the hardened transport
    except NetskopeError as exc:
        message = re.sub(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+", "<email>", str(exc))[:200]
        return {"path": path.split("?")[0], "method": method, "ok": False, "error": message}
    return {"path": path.split("?")[0], "method": method, "ok": True, "seconds": round(time.monotonic() - started, 1), **describe(payload), "_payload": payload}


def strip(result: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in result.items() if key != "_payload"}


def find_user(payload: Any) -> str | None:
    if isinstance(payload, dict):
        for value in payload.values():
            found = find_user(value)
            if found:
                return found
    elif isinstance(payload, list):
        for value in payload[:50]:
            found = find_user(value)
            if found:
                return found
    elif isinstance(payload, str) and EMAIL.match(payload):
        return payload
    return None


def find_key(payload: Any, names: tuple[str, ...]) -> Any:
    if isinstance(payload, dict):
        for key, value in payload.items():
            if key in names and isinstance(value, (str, int)):
                return value
        for value in payload.values():
            found = find_key(value, names)
            if found is not None:
                return found
    elif isinstance(payload, list):
        for value in payload[:50]:
            found = find_key(value, names)
            if found is not None:
                return found
    return None


def egress_ips() -> set[str]:
    path = os.getenv("NETSKOPE_PROBE_EGRESS_FILE", "").strip()
    if not path or not Path(path).is_file():
        return set()
    return {line.strip() for line in Path(path).read_text().splitlines() if line.strip()}


async def alert_origin(client: NetskopeClient, settings: NetskopeSettings, dimension: str, hours: int, egress: set[str]) -> dict[str, Any]:
    now = int(time.time())
    params = {"starttime": now - hours * 3600, "endtime": now, "fields": "count_total:count(id)", "groupbys": dimension}
    separator = "&" if "?" in settings.alert_path else "?"
    result = await call(client, "GET", f"{settings.alert_path}{separator}{urlencode(params)}")
    summary = strip(result)
    summary["dimension"] = dimension
    summary["window_hours"] = hours
    rows = result.get("_payload", {}).get("result") if result.get("ok") and isinstance(result.get("_payload"), dict) else None
    if isinstance(rows, list):
        counts: list[tuple[Any, int]] = []
        for row in rows:
            key = row.get("_id")
            if isinstance(key, dict) and len(key) == 1:
                key = next(iter(key.values()))
            if isinstance(row.get("count_total"), int):
                counts.append((key, row["count_total"]))
        total = sum(count for _, count in counts)
        summary["groups"] = len(counts)
        summary["events"] = total
        if counts and total:
            summary["top1_share"] = round(max(count for _, count in counts) / total, 3)
        if egress:
            matched = sum(count for key, count in counts if isinstance(key, str) and key in egress)
            summary["matches_egress_list"] = {"groups": sum(1 for key, _ in counts if isinstance(key, str) and key in egress), "events": matched, "share": round(matched / total, 3) if total else None}
    return summary


def get_in(row: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        row = row.get(key) if isinstance(row, dict) else None
    return row


def label(value: Any) -> str:
    return value if isinstance(value, str) and LABEL.match(value) and len(value) <= 40 else ("<empty>" if value in (None, "") else "<other>")


async def client_tally(client: NetskopeClient) -> dict[str, Any]:
    """Counts only: categories of the on-prem fields and how they relate to the egress list."""
    devices = await client.get_devices()
    if os.getenv("NETSKOPE_PROBE_RECENT_DAYS", "").isdigit():
        cutoff = time.time() - int(os.environ["NETSKOPE_PROBE_RECENT_DAYS"]) * 86400
        devices = [row for row in devices if isinstance(row.get("last_event_timestamp"), (int, float)) and cutoff <= row["last_event_timestamp"] <= time.time() + 3600]
    egress = egress_ips()
    fields = {
        "onpremises_status": ("onpremises_status",),
        "onprem_status.status": ("onprem_status", "status"),
        "onprem_status.method": ("onprem_status", "method"),
        "host_info.client_config": ("host_info", "client_config"),
        "host_info.steering_config": ("host_info", "steering_config"),
        "pop_pinned": ("pop_pinned",),
        "classification": ("user_info", "device_classification_status"),
    }
    tallies = {name: Counter(label(get_in(row, *path)) for row in devices) for name, path in fields.items()}
    public = [get_in(row, "last_connected_from_public_ip") for row in devices]
    valid = [ip for ip in public if isinstance(ip, str) and text_class(ip) == "ip"]
    status = [label(get_in(row, "onpremises_status")) for row in devices]
    report: dict[str, Any] = {
        "devices": len(devices),
        "tallies": {name: dict(tally.most_common(30)) for name, tally in tallies.items()},
        "public_ip": {"with_value": len(valid), "distinct": len(set(valid)), "top1_share": round(Counter(valid).most_common(1)[0][1] / len(valid), 3) if valid else None},
        "match_ip_present": sum(1 for row in devices if isinstance(get_in(row, "onprem_status", "match_ip"), str) and get_in(row, "onprem_status", "match_ip")),
    }
    if egress:
        inside = [isinstance(ip, str) and ip in egress for ip in public]
        cross: Counter[str] = Counter()
        for in_list, state in zip(inside, status, strict=True):
            cross[f"{'public_ip_in_egress_list' if in_list else 'public_ip_not_in_list'} | {state}"] += 1
        report["egress_list_loaded"] = len(egress)
        report["devices_with_public_ip_in_list"] = sum(inside)
        report["cross_tab"] = dict(sorted(cross.items()))
    return report


async def uba_probe(client: NetskopeClient) -> dict[str, Any]:
    ranked = await client.get_ranked_uci()
    users = [row.get("user") for row in ranked if isinstance(row.get("user"), str) and EMAIL.match(row.get("user", ""))][:25]
    report: dict[str, Any] = {"ranked_users": len(ranked), "sample_users": len(users), "results": []}
    for days in (30, 90):
        result = await call(client, "POST", "/api/v2/incidents/users/getanomalies", {"users": users, "timeframe": days, "limit": 50})
        entry = strip(result)
        entry["timeframe_days"] = days
        report["results"].append(entry)
    first = await client._request_json("POST", "/api/v2/incidents/users/getanomalies", body={"users": users, "timeframe": 30, "limit": 1000})  # noqa: SLF001
    rows = [row for row in (first.get("results") if isinstance(first, dict) else []) if isinstance(row, dict)]
    per_user = Counter(row.get("user") for row in rows)
    report["category_counts"] = {
        name: dict(Counter(label(row.get(name)) for row in rows).most_common(12))
        for name in ("scenario", "subScenario", "ruleName", "activity", "alertType", "severity", "accessMethod")
    }
    report["rows_returned"] = len(rows)
    report["users_with_anomalies_of_sample"] = len(per_user)
    report["per_user_anomalies"] = {"min": min(per_user.values(), default=0), "median": statistics.median(per_user.values()) if per_user else 0, "max": max(per_user.values(), default=0)}
    report["rows_with_source_ip"] = sum(1 for row in rows if isinstance(row.get("sourceIp"), str) and text_class(row["sourceIp"]) == "ip")
    scenarios = await client._request_json("GET", f"/api/v2/incidents/users/scenarios?{urlencode({'lastxdays': 30})}")  # noqa: SLF001
    report["scenario_catalog"] = {label(item.get("scenario")): [label(sub) if isinstance(sub, str) else label(sub.get("subScenario") if isinstance(sub, dict) else None) for sub in item.get("subScenarios", [])] for item in scenarios if isinstance(item, dict)}
    for days in (30,):
        result = await call(client, "GET", f"/api/v2/incidents/users/scenarios?{urlencode({'lastxdays': days})}")
        report["results"].append({**strip(result), "lastxdays": days})
    return report


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hours", type=int, default=24, help="ADEM tenant window (max 48)")
    parser.add_argument("--skip-alerts", action="store_true")
    parser.add_argument("--uba", action="store_true", help="only probe UBA anomalies and scenarios over users with a low UCI")
    parser.add_argument("--client-tally", action="store_true", help="only tally the on-prem fields of every client status record")
    args = parser.parse_args()
    load_dotenv(ROOT / ".env.local")
    settings = NetskopeSettings.from_environment()
    now = int(time.time())
    window = {"starttime": now - min(args.hours, 48) * 3600, "endtime": now}
    if args.uba:
        async with NetskopeClient(settings) as client:
            print(json.dumps(await uba_probe(client), ensure_ascii=False, indent=1, default=str))
        return 0
    if args.client_tally:
        async with NetskopeClient(settings) as client:
            print(json.dumps(await client_tally(client), ensure_ascii=False, indent=1))
        return 0
    report: dict[str, Any] = {"probe_version": PROBE_VERSION, "read_only": True, "window_hours": min(args.hours, 48), "results": []}
    results: list[dict[str, Any]] = report["results"]

    async with NetskopeClient(settings) as client:
        # 1. ADEM tenant level.
        summary = await call(client, "POST", "/api/v2/adem/users/getsummary", {**window, "limit": 50})
        entities = await call(client, "POST", "/api/v2/adem/users/getentities", {**window, "limit": 100})
        results.extend(strip(item) for item in (summary, entities))
        user = find_user(entities.get("_payload")) or find_user(summary.get("_payload"))
        report["probe_user_found"] = bool(user)

        # 2. ADEM per user (the user is never printed).
        device_id = None
        if user:
            body = {**window, "user": user}
            for path in ("/api/v2/adem/users/getinfo", "/api/v2/adem/users/getapplications", "/api/v2/adem/users/getlocations"):
                results.append(strip(await call(client, "POST", path, body)))
            devices = await call(client, "POST", "/api/v2/adem/users/device/getlist", {**body, "userLocation": []})
            results.append(strip(devices))
            device_id = find_key(devices.get("_payload"), ("deviceId",))
            if device_id:
                detail = {**body, "deviceId": device_id}
                for path in ("/api/v2/adem/users/device/getdetails", "/api/v2/adem/users/device/getrca",
                             "/api/v2/adem/users/device/getaggregatedscores", "/api/v2/adem/users/metrics/getexpscore"):
                    results.append(strip(await call(client, "POST", path, detail)))

        # 3. UBA (user behaviour).
        if user:
            month = {"fromTime": now - 30 * 86400, "toTime": now}
            results.append(strip(await call(client, "POST", "/api/v2/incidents/users/getanomalies", {"users": [user], "timeframe": 30, "limit": 5})))
            results.append(strip(await call(client, "POST", "/api/v2/incidents/uba/getuci", {"users": [user], **month})))
            results.append(strip(await call(client, "POST", "/api/v2/ubadatasvc/user/uci", {"user": user, **month})))
        for path in ("/api/v2/incidents/users/scenarios", "/api/v2/incidents/watchlists"):
            results.append(strip(await call(client, "GET", path)))

        # 4. Client status: does a device record carry a network or IP field?
        query = urlencode({"offset": 0, "limit": 20})
        separator = "&" if "?" in settings.device_status_path else "?"
        results.append(strip(await call(client, "GET", f"{settings.device_status_path}{separator}{query}")))

        # 5. Alert origin: which dimensions say where the traffic came from.
        if not args.skip_alerts and settings.alert_path:
            egress = egress_ips()
            report["egress_list_loaded"] = len(egress)
            origin = []
            for dimension in ("access_method", "userip", "srcip", "src_country", "src_location", "site", "connection_type"):
                origin.append(await alert_origin(client, settings, dimension, 6, egress))
            report["alert_origin"] = origin

    print(json.dumps(report, ensure_ascii=False, indent=1, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
