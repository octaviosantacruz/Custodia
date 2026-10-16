"""Historical Netskope decisions on real PostgreSQL: they survive retirement and
the card counts exactly what its drill lists. Opt-in; see tests/support/pg_integration_base.py."""

import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

from psycopg.errors import RestrictViolation

from app.db import fetch_all
from app.netskope.sse.repositories.netskope_device_reviews import (
    get_device_review_summary, reviews_for_objects,
)
from app.netskope.sse.repositories.netskope_metrics import get_netskope_metrics
from app.netskope.sse.repositories.netskope_queries import list_netskope_objects
from tests.support.netskope_pg_fixtures import (
    insert_netskope_run, reset_netskope, reset_netskope_runs, seed_device, seed_device_review,
)
from tests.support.pg_integration_base import PostgresIntegrationTestCase

DAY = 86400


def ago(days: float) -> int:
    return int(datetime.now(timezone.utc).timestamp() - days * DAY)


class NetskopeDeviceReviewsPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        await self._clean()
        self.addAsyncCleanup(self._clean)

    async def _clean(self):
        await reset_netskope(self.pool)
        await reset_netskope_runs(self.pool)

    async def test_a_decision_survives_the_device_being_retired_and_the_inventory_cannot_drop_it(self):
        device = await seed_device(self.pool, "d-gone", {"last_event_timestamp": ago(90)})
        await seed_device_review(self.pool, device, {"diagnosis": "uninstalled_reported", "status": "investigating"}, "ana")
        # What a complete sync does to an absent device: retire, never delete.
        await fetch_all(self.pool, "UPDATE public.cyberark_inventory_objects SET lifecycle_status = 'retired' WHERE object_id = %s RETURNING 1", (device,))
        self.assertEqual((await reviews_for_objects(self.pool, [device]))[device]["status"], "investigating")
        with self.assertRaises(RestrictViolation):
            await fetch_all(self.pool, "DELETE FROM public.cyberark_inventory_objects WHERE object_id = %s RETURNING 1", (device,))

    async def test_listing_filters_and_projection_follow_the_decision(self):
        old = {"last_event_timestamp": ago(100)}
        a = await seed_device(self.pool, "a", old)
        b = await seed_device(self.pool, "b", old)
        c = await seed_device(self.pool, "c", old)
        d = await seed_device(self.pool, "d", {"last_event_timestamp": ago(60)})
        await seed_device_review(self.pool, a, {"diagnosis": "replaced", "status": "investigating"}, "ana")
        await seed_device_review(self.pool, b, {"diagnosis": "undetermined"}, "ana")
        await fetch_all(self.pool, """INSERT INTO public.netskope_device_reviews (object_id, diagnosis, status, note, exception_expires_at, decided_by)
            VALUES (%s, 'temporary_exception', 'resolved', 'reserva', now() - interval '1 day', 'ana') RETURNING 1""", (d,))

        async def ids(**kw):
            return {row["object_id"] for row in (await list_netskope_objects(self.pool, "device", "", 50, 0, freshness="all", **kw))["rows"]}

        self.assertEqual(await ids(review_diagnosis="replaced"), {a})
        # Nobody classified c, and b is explicitly undetermined: both are "sin clasificar".
        self.assertEqual(await ids(review_diagnosis="undetermined"), {b, c})
        self.assertEqual(await ids(review_status="investigating"), {a})
        # A lapsed exception is attention-worthy again even though its stored status says resolved.
        self.assertEqual(await ids(review_diagnosis="temporary_exception", review_status="pending"), {d})
        self.assertEqual(await ids(review_status="resolved"), set())
        rows = {row["object_id"]: row for row in (await list_netskope_objects(self.pool, "device", "", 50, 0, freshness="all"))["rows"]}
        self.assertIsNone(rows[c]["review"])
        self.assertEqual(rows[a]["review"]["diagnosis"], "replaced")
        self.assertTrue(rows[d]["review"]["exception_expired"])
        self.assertEqual((rows[d]["review"]["status"], rows[d]["review"]["effective_status"]), ("resolved", "pending"))

    async def test_summary_counts_what_the_drill_lists_and_the_unclassified_figure_needs_a_fresh_sync(self):
        old = {"last_event_timestamp": ago(100)}
        a = await seed_device(self.pool, "a", old)
        b = await seed_device(self.pool, "b", old)
        c = await seed_device(self.pool, "c", old)
        recent = await seed_device(self.pool, "recent", {"last_event_timestamp": ago(1)})
        await seed_device(self.pool, "nodate", {})
        await seed_device_review(self.pool, a, {"diagnosis": "in_use_not_reporting", "status": "ticket_open", "reference": "INC-1"}, "ana")
        await seed_device_review(self.pool, b, {"diagnosis": "in_use_not_reporting", "status": "resolved"}, "ana")
        # It reported again after its review: out of the candidates, counted as returned.
        await seed_device_review(self.pool, recent, {"diagnosis": "historical_record"}, "ana")
        await insert_netskope_run(self.pool, "completed", hours=1)

        summary = await get_device_review_summary(self.pool)
        counts = {bucket["key"]: bucket["count"] for bucket in summary["buckets"]}
        self.assertEqual(summary["candidates"], 3)
        self.assertEqual(counts["in_use_not_reporting"], 2)
        self.assertEqual(counts["undetermined"], 1)
        self.assertEqual(sum(counts.values()), summary["candidates"])
        self.assertEqual((summary["open_incidents"], summary["unclassified"], summary["reported_again"]), (1, 1, 0))
        for key, count in counts.items():
            with self.subTest(key=key):
                listed = await list_netskope_objects(self.pool, "device", "", 50, 0, event_age="gt_30d", freshness="all", review_diagnosis=key)
                self.assertEqual(listed["total"], count)
        await fetch_all(self.pool, "UPDATE public.netskope_device_reviews SET decided_at = now() - interval '3 days' WHERE object_id = %s RETURNING 1", (recent,))
        self.assertEqual((await get_device_review_summary(self.pool))["reported_again"], 1)

        await reset_netskope_runs(self.pool)
        await insert_netskope_run(self.pool, "partial", hours=1)
        stale_sync = await get_device_review_summary(self.pool)
        self.assertIsNone(stale_sync["unclassified"])
        self.assertEqual(stale_sync["candidates"], 3)
        self.assertEqual(stale_sync["open_incidents"], 1)
        self.assertFalse(stale_sync["source_evidence"]["source_fresh"])
        self.assertIsNotNone(c)

    async def test_no_sync_or_integration_code_writes_the_decision_table(self):
        root = Path(__file__).resolve().parents[2] / "app"
        allowed = {
            "netskope/sse/repositories/netskope_device_reviews.py", "netskope/sse/repositories/netskope_inventory.py",
            "schema.py", "netskope/sse/source.py",
            "netskope/sse/services/netskope_state.py",  # route-facing re-export only (ARCH-LAYERS-002)
        }
        offenders = [
            str(path.relative_to(root)) for path in root.rglob("*.py")
            if "netskope_device_reviews" in path.read_text(encoding="utf-8") and str(path.relative_to(root)) not in allowed
            and not re.search(r"routes/(netskope_device_reviews|cmdb_netskope)", str(path))
        ]
        self.assertEqual(offenders, [])


def _stale(days, **extra):
    return {"last_event_timestamp": ago(days), **extra}


class NetskopeDeviceReviewSuggestionsPostgresTests(PostgresIntegrationTestCase):
    """NSK-DEVREV-002: suggestions come only from reported evidence, never classify by themselves and
    every count has a listing filter that returns exactly the devices it counts."""

    async def asyncSetUp(self):
        await super().asyncSetUp()
        await self._clean()
        self.addAsyncCleanup(self._clean)

    async def _clean(self):
        await fetch_all(self.pool, "DELETE FROM public.access_audit_log WHERE entity_type IN ('netskope_device_review', 'netskope_device_review_batch') RETURNING 1")
        await reset_netskope(self.pool)
        await reset_netskope_runs(self.pool)

    async def _seed(self):
        ids = {}
        ids["uninstalled"] = await seed_device(self.pool, "uninst", _stale(100, last_seen_event="Uninstalled"))
        ids["replaced"] = await seed_device(self.pool, "repl", _stale(100, hostname="H1", username="U@X.COM"))
        await seed_device(self.pool, "repl-new", {"last_event_timestamp": ago(1), "hostname": "h1", "username": "u@x.com"})
        ids["ambiguous"] = await seed_device(self.pool, "amb", _stale(100, hostname="H2", username="u2@x.com"))
        await seed_device(self.pool, "amb-new-1", {"last_event_timestamp": ago(1), "hostname": "H2", "username": "u2@x.com"})
        await seed_device(self.pool, "amb-new-2", {"last_event_timestamp": ago(2), "hostname": "h2", "username": "u2@x.com"})
        ids["host_only"] = await seed_device(self.pool, "hostonly", _stale(100, hostname="H3", username="a@x.com"))
        await seed_device(self.pool, "hostonly-new", {"last_event_timestamp": ago(1), "hostname": "H3", "username": "b@x.com"})
        ids["both"] = await seed_device(self.pool, "both", _stale(250, last_seen_event="Admin Disabled", hostname="H4", username="d@x.com"))
        await seed_device(self.pool, "both-new", {"last_event_timestamp": ago(1), "hostname": "H4", "username": "d@x.com"})
        ids["historical"] = await seed_device(self.pool, "hist", _stale(200))
        ids["hist_undetermined"] = await seed_device(self.pool, "hist-undet", _stale(200))
        ids["classified"] = await seed_device(self.pool, "classified", _stale(200))
        ids["plain"] = await seed_device(self.pool, "plain", _stale(100, os="Windows"))
        ids["recent"] = await seed_device(self.pool, "recent", {"last_event_timestamp": ago(1), "last_seen_event": "Uninstalled"})
        ids["future"] = await seed_device(self.pool, "future", {"last_event_timestamp": ago(-3)})
        await seed_device_review(self.pool, ids["hist_undetermined"], {"diagnosis": "undetermined", "status": "investigating"}, "ana")
        await seed_device_review(self.pool, ids["classified"], {"diagnosis": "historical_record"}, "ana")
        await insert_netskope_run(self.pool, "completed", hours=1)
        return ids

    async def _listed(self, **kw):
        result = await list_netskope_objects(self.pool, "device", "", 500, 0, freshness="all", **kw)
        return {row["object_id"] for row in result["rows"]}, result

    async def test_the_suggestion_follows_the_evidence_and_the_listing_returns_exactly_what_the_summary_counts(self):
        ids = await self._seed()
        expected = {
            "uninstalled_reported": {ids["uninstalled"], ids["both"]},
            "replaced": {ids["replaced"]},
            "historical_record": {ids["historical"], ids["hist_undetermined"]},
        }
        summary = await get_device_review_summary(self.pool)
        self.assertEqual({item["key"]: item["count"] for item in summary["suggestions"]}, {key: len(value) for key, value in expected.items()})
        for key, members in expected.items():
            with self.subTest(suggestion=key):
                listed, _ = await self._listed(review_suggestion=key)
                self.assertEqual(listed, members)
        # Every row carries the same suggestion the filter used; a classified, plain, recent or future device carries none.
        _, everything = await self._listed()
        by_id = {row["object_id"]: row["review_suggestion"] for row in everything["rows"]}
        for key, members in expected.items():
            for object_id in members:
                self.assertEqual(by_id[object_id], key)
        for name in ("ambiguous", "host_only", "classified", "plain", "recent", "future"):
            self.assertIsNone(by_id[ids[name]], name)
        # No suggestion means an unclassified stale device evaluated with a fresh sync,
        # not every row whose suggestion is null (recent, classified or invalid dates).
        await seed_device(self.pool, "no-date", {})
        await seed_device(self.pool, "zero-date", {"last_event_timestamp": 0})
        manual, manual_result = await self._listed(review_suggestion="none")
        self.assertEqual(manual, {ids["ambiguous"], ids["host_only"], ids["plain"]})
        self.assertEqual(manual_result["total"], summary["unclassified"] - sum(item["count"] for item in summary["suggestions"]))
        filtered, _ = await self._listed(review_suggestion="none", filters={"os": "Windows"})
        self.assertEqual(filtered, {ids["plain"]})
        await seed_device_review(self.pool, ids["plain"], {"diagnosis": "in_use_not_reporting"}, "ana")
        manual_after, _ = await self._listed(review_suggestion="none")
        self.assertEqual(manual_after, {ids["ambiguous"], ids["host_only"]})

    async def test_without_a_complete_recent_sync_nothing_is_suggested(self):
        await self._seed()
        await reset_netskope_runs(self.pool)
        await insert_netskope_run(self.pool, "partial", hours=1)
        summary = await get_device_review_summary(self.pool)
        self.assertIsNone(summary["suggestions"])
        for key in ("uninstalled_reported", "replaced", "historical_record", "none"):
            listed, _ = await self._listed(review_suggestion=key)
            self.assertEqual(listed, set())

    async def test_attention_drills_return_exactly_the_devices_the_summary_counts(self):
        old = _stale(100)
        incident = await seed_device(self.pool, "incident", old)
        resolved = await seed_device(self.pool, "resolved", old)
        lapsed = await seed_device(self.pool, "lapsed", old)
        future_exc = await seed_device(self.pool, "future-exc", old)
        returned = await seed_device(self.pool, "returned", {"last_event_timestamp": ago(1)})
        await seed_device_review(self.pool, incident, {"diagnosis": "in_use_not_reporting", "status": "investigating"}, "ana")
        await seed_device_review(self.pool, resolved, {"diagnosis": "in_use_not_reporting", "status": "resolved"}, "ana")
        await seed_device_review(self.pool, returned, {"diagnosis": "historical_record"}, "ana")
        await seed_device_review(self.pool, future_exc, {"diagnosis": "temporary_exception", "owner": "Ops", "note": "reserva", "exception_expires_at": datetime.now(timezone.utc) + timedelta(days=30)}, "ana")
        await fetch_all(self.pool, """INSERT INTO public.netskope_device_reviews (object_id, diagnosis, status, owner, note, exception_expires_at, decided_by)
            VALUES (%s, 'temporary_exception', 'resolved', 'Ops', 'reserva', now() - interval '1 day', 'ana') RETURNING 1""", (lapsed,))
        await fetch_all(self.pool, "UPDATE public.netskope_device_reviews SET decided_at = now() - interval '3 days' WHERE object_id = %s RETURNING 1", (returned,))
        await insert_netskope_run(self.pool, "completed", hours=1)
        summary = await get_device_review_summary(self.pool)
        expected = {"open_incident": ({incident}, summary["open_incidents"]), "expired_exception": ({lapsed}, summary["expired_exceptions"]), "reported_again": ({returned}, summary["reported_again"])}
        for attention, (members, counted) in expected.items():
            with self.subTest(attention=attention):
                listed, _ = await self._listed(review_attention=attention)
                self.assertEqual((listed, counted), (members, len(members)))

    async def test_dashboard_metrics_no_longer_split_the_stale_population_by_diagnosis(self):
        # NSK-INV-002: the diagnosis widgets retired; a saved decision never changes the stale count.
        classified = await seed_device(self.pool, "w1", _stale(100, os="Windows"))
        await seed_device(self.pool, "m1", _stale(100, os="Mac"))
        await seed_device_review(self.pool, classified, {"diagnosis": "in_use_not_reporting"}, "ana")
        await insert_netskope_run(self.pool, "completed", hours=1)
        full = await get_netskope_metrics(self.pool, {})
        self.assertEqual(full["devices_stale_30d"], 2)
        self.assertNotIn("devices_stale_unclassified", full)
        self.assertNotIn("devices_stale_by_diagnosis", full)
