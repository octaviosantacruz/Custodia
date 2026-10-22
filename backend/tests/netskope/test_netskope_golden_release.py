"""NSK-GOLDEN-001: golden releases from the public documentation page are a validated, bounded suggestion."""

import os
import unittest
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx

from app.netskope.sse.integrations.netskope import NetskopeError, NetskopeNotConfigured
from app.netskope.sse.integrations.netskope_golden_release import (
    GOLDEN_RELEASE_URL, MAX_BODY_BYTES, fetch_golden_releases, netskope_golden_release_configured, parse_golden_releases,
)
from app.netskope.sse.netskope_sync import dispatch_netskope_run
from app.netskope.sse.source import NETSKOPE_TASKS

PLAIN = ("<p><strong>Current Golden Release:</strong> 141</p><ul>"
         "<li>Golden Release Updates Between 138.0.0 and 141.0.0</li>"
         "<li>Golden Release Updates Between 135.0.0 and 138.0.0</li></ul>")
# The live page also embeds the same text as escaped JSON inside a script.
ESCAPED = PLAIN.replace("<", "\\u003c").replace(">", "\\u003e")
CONFIGURED = {"NETSKOPE_GOLDEN_RELEASE_URL": GOLDEN_RELEASE_URL}


class ParseTests(unittest.TestCase):
    def test_current_and_previous_golden_come_from_the_matching_range(self):
        for page in (PLAIN, ESCAPED):
            self.assertEqual(parse_golden_releases(page), ["141.0.0", "138.0.0"])

    def test_an_unexpected_shape_fails_instead_of_guessing(self):
        bad = {
            "no current": "<p>Golden Release Updates Between 138.0.0 and 141.0.0</p>",
            "no matching range": "<strong>Current Golden Release:</strong> 141 Golden Release Updates Between 135.0.0 and 138.0.0",
            "out of range": "Current Golden Release: 7 Golden Release Updates Between 4.0.0 and 7.0.0",
            "inverted range": "Current Golden Release: 141 Golden Release Updates Between 141.0.0 and 141.0.0",
            "not a number": "Current Golden Release: latest",
        }
        for name, page in bad.items():
            with self.subTest(name), self.assertRaises(NetskopeError):
                parse_golden_releases(page)


def _transport(handler):
    return httpx.MockTransport(handler)


class FetchTests(unittest.IsolatedAsyncioTestCase):
    async def test_requires_the_exact_approved_url(self):
        for value in ("", "https://example.com/golden", GOLDEN_RELEASE_URL + "?x=1"):
            with self.subTest(value), patch.dict(os.environ, {"NETSKOPE_GOLDEN_RELEASE_URL": value}, clear=True):
                self.assertFalse(netskope_golden_release_configured())
                with self.assertRaises(NetskopeNotConfigured):
                    await fetch_golden_releases()

    async def test_reads_the_page_with_one_anonymous_get(self):
        seen = []

        def handler(request):
            seen.append(request)
            return httpx.Response(200, text=PLAIN)

        with patch.dict(os.environ, CONFIGURED, clear=True):
            self.assertEqual(await fetch_golden_releases(_transport(handler)), ["141.0.0", "138.0.0"])
        self.assertEqual([(r.method, str(r.url)) for r in seen], [("GET", GOLDEN_RELEASE_URL)])
        self.assertNotIn("authorization", seen[0].headers)

    async def test_errors_redirects_and_oversized_bodies_fail_clearly(self):
        cases = {
            "server error": httpx.Response(500, text="boom"),
            "redirect": httpx.Response(302, headers={"location": "https://evil.example/x"}),
            "too large": httpx.Response(200, content=b"x" * (MAX_BODY_BYTES + 1)),
        }
        for name, response in cases.items():
            with self.subTest(name), patch.dict(os.environ, CONFIGURED, clear=True), self.assertRaises(NetskopeError):
                await fetch_golden_releases(_transport(lambda request, response=response: response))

    async def test_network_failure_is_a_controlled_error(self):
        def handler(request):
            raise httpx.ConnectError("down")

        with patch.dict(os.environ, CONFIGURED, clear=True), self.assertRaises(NetskopeError):
            await fetch_golden_releases(_transport(handler))


class TaskTests(unittest.IsolatedAsyncioTestCase):
    def test_the_task_is_scheduled_daily_and_opt_in(self):
        task = next(item for item in NETSKOPE_TASKS if item.task_key == "netskope_golden_release")
        self.assertEqual(task.policy.interval_minutes, 1440)
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(task.is_configured())
        with patch.dict(os.environ, CONFIGURED, clear=True):
            self.assertTrue(task.is_configured())

    async def test_the_run_stores_a_suggestion_and_never_touches_baselines(self):
        run_id = uuid4()
        pool = object()
        save = AsyncMock()
        with patch("app.netskope.sse.netskope_sync.fetch_golden_releases", new=AsyncMock(return_value=["141.0.0", "138.0.0"])), \
             patch("app.netskope.sse.netskope_sync.save_golden_suggestion", new=save):
            result = await dispatch_netskope_run(pool, {"run_id": run_id, "task_key": "netskope_golden_release"})
        self.assertEqual(result, {"objects": 2, "relationships": 0})
        save.assert_awaited_once_with(pool, ["141.0.0", "138.0.0"], GOLDEN_RELEASE_URL, run_id)

    async def test_a_failed_read_fails_the_run_and_keeps_the_previous_suggestion(self):
        save = AsyncMock()
        with patch("app.netskope.sse.netskope_sync.fetch_golden_releases", new=AsyncMock(side_effect=NetskopeError("x"))), \
             patch("app.netskope.sse.netskope_sync.save_golden_suggestion", new=save), self.assertRaises(NetskopeError):
            await dispatch_netskope_run(object(), {"run_id": uuid4(), "task_key": "netskope_golden_release"})
        save.assert_not_awaited()
