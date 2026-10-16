"""The benchmark walks bounded, isolated pages and never emits event values."""

import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import AsyncMock, patch
from datetime import datetime, timezone

import httpx

from app.netskope.sse.integrations.netskope import NetskopeClient, NetskopeSettings

SPEC = importlib.util.spec_from_file_location(
    "iterator_benchmark", Path(__file__).resolve().parents[3] / "scripts/benchmark_netskope_iterator.py",
)
benchmark = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(benchmark)


class IteratorBenchmarkTests(unittest.IsolatedAsyncioTestCase):
    async def test_bounded_sample_honors_wait_and_reports_no_event_values(self):
        requests = []
        now = datetime(2026, 10, 2, tzinfo=timezone.utc)

        def handler(request):
            requests.append(request)
            return httpx.Response(200, json={
                "result": [{"dlp_incident_id": "private-incident", "timestamp": int(now.timestamp()),
                            "user_id": "private-user", "user": "secret@example.test"}],
                "timestamp_hwm": int(now.timestamp()), "wait_time": 5,
            })

        settings = NetskopeSettings(
            base_url="https://tenant.example", api_token="test", device_status_path="/devices",
            users_path="/users", user_counts_path="/counts",
            dlp_incidents_path="/api/v2/events/dataexport/events/incident",
        )
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            def client_factory(settings):
                return NetskopeClient(settings, http)

            with patch.object(benchmark.asyncio, "sleep", new=AsyncMock()) as sleep:
                result, ids = await benchmark.sample(client_factory, settings, now, now, retain=False)
        self.assertEqual(len(requests), 3)
        self.assertEqual(result["events"], 3)
        self.assertEqual(result["distinct_incidents"], 1)
        self.assertEqual(ids, {"private-incident"})
        self.assertEqual([call.args[0] for call in sleep.await_args_list], [5, 5])
        self.assertEqual(len({request.url.params["index"] for request in requests}), 1)
        self.assertEqual([request.url.params["operation"] for request in requests], [str(int(now.timestamp())), "next", "next"])
        for secret in ("private-incident", "private-user", "secret@example.test"):
            self.assertNotIn(secret, json.dumps(result))
